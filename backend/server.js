const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createPool({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'checkout_user',
    password: process.env.DB_PASSWORD || 'checkout_password',
    database: process.env.DB_NAME || 'checkout_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

app.get('/', (req, res) => {
    res.json({ message: 'API do Checkout rodando!' });
});

app.get('/produtos', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, nome, preco, imagem_url FROM produtos');
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar produtos:', error);
        res.status(500).json({ error: 'Erro ao buscar produtos.' });
    }
});

// Rota para acompanhar os pedidos e seus status atualizados
app.get('/pedidos', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM pedidos ORDER BY id DESC');
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar pedidos:', error);
        res.status(500).json({ error: 'Erro ao buscar pedidos.' });
    }
});

// Iniciar o Checkout no carrinho
app.post('/checkout', async (req, res) => {
    const { itens } = req.body; // Espera: [{ produtoId: 1, quantidade: 2 }, ...]

    if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'O carrinho está vazio.' });
    }

    try {
        // 1. Busca os preços reais de todos os produtos enviados
        const ids = itens.map(item => item.produtoId);
        const [produtos] = await db.query('SELECT * FROM produtos WHERE id IN (?)', [ids]);

        if (produtos.length === 0) {
            return res.status(404).json({ error: 'Produtos não encontrados.' });
        }

        let totalPedido = 0;
        const itensMercadoPago = [];
        const itensParaBanco = [];

        for (const item of itens) {
            const produto = produtos.find(p => p.id === item.produtoId);
            if (!produto) continue;

            const qtd = Math.max(1, Number(item.quantidade) || 1);
            const preco = Number(produto.preco);
            totalPedido += preco * qtd;

            itensMercadoPago.push({
                id: String(produto.id),
                title: produto.nome,
                quantity: qtd,
                unit_price: preco,
                currency_id: 'BRL'
            });

            itensParaBanco.push({
                produtoId: produto.id,
                quantidade: qtd,
                precoUnitario: preco
            });
        }

        // 2. Cria o pedido no banco com o valor total real
        const [pedidoResult] = await db.query(
            'INSERT INTO pedidos (total, status) VALUES (?, ?)',
            [totalPedido, 'pendente']
        );
        const pedidoId = pedidoResult.insertId;

        // 3. Salva todos os itens vinculados ao pedido
        for (const item of itensParaBanco) {
            await db.query(
                'INSERT INTO pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)',
                [pedidoId, item.produtoId, item.quantidade, item.precoUnitario]
            );
        }

        // 4. Cria a preferência no Mercado Pago
        const preferenceBody = {
            items: itensMercadoPago,
            external_reference: String(pedidoId),
            back_urls: {
                success: 'http://localhost:8090/?status=sucesso',
                failure: 'http://localhost:8090/?status=erro',
                pending: 'http://localhost:8090/?status=pendente'
            }
        };

        if (process.env.WEBHOOK_URL) {
            preferenceBody.notification_url = `${process.env.WEBHOOK_URL}/webhook/mercadopago`;
        }

        const preference = new Preference(mpClient);
        const response = await preference.create({ body: preferenceBody });

        res.json({
            pedidoId,
            init_point: response.init_point,
            sandbox_init_point: response.sandbox_init_point
        });

    } catch (error) {
        console.error('Erro ao criar checkout:', error);
        res.status(500).json({ error: 'Erro ao iniciar pagamento no Mercado Pago.' });
    }
});

// ROTA DE WEBHOOK: Recebe o aviso do Mercado Pago e atualiza o MySQL
app.post('/webhook/mercadopago', async (req, res) => {
    // O Mercado Pago pode enviar o ID no body (Webhooks) ou na query (IPN)
    const paymentId = req.body?.data?.id || req.query['data.id'] || req.query.id;
    const type = req.body?.type || req.query.topic;

    console.log('Webhook recebido:', { type, paymentId });

 
    res.sendStatus(200);

    if (type !== 'payment' || !paymentId) {
        return;
    }

    try {
        // Consulta a API oficial do Mercado Pago para não confiar apenas no payload recebido
        const payment = new Payment(mpClient);
        const pagamento = await payment.get({ id: paymentId });

        const pedidoId = pagamento.external_reference;
        const statusMP = pagamento.status; // 'approved', 'pending', 'rejected', etc.

        // Traduz o status do Mercado Pago para o padrão do banco
        const mapaStatus = {
            approved: 'aprovado',
            pending: 'pendente',
            in_process: 'em_analise',
            rejected: 'recusado',
            cancelled: 'cancelado',
            refunded: 'estornado'
        };
        const statusLocal = mapaStatus[statusMP] || statusMP;

        if (pedidoId) {
            await db.query(
                'UPDATE pedidos SET status = ?, transacao_id = ? WHERE id = ?',
                [statusLocal, String(paymentId), pedidoId]
            );
            console.log(`Pedido #${pedidoId} atualizado para '${statusLocal}' (Transação: ${paymentId})`);
        }
    } catch (error) {
        console.error('Erro ao processar webhook:', error);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});