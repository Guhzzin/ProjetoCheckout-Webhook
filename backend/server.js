const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const {MercadoPagoConfig, Preference} = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());


// Configuração do pool de conexão com o banco de dados
const db = mysql.createPool({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'checkout_user',
    password: process.env.DB_PASSWORD || 'checkout_password',
    database: process.env.DB_NAME || 'checkout_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

//configurações do mercado pago
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

app.get('/', (req, res) => {
    res.json({ message: 'API do Checkout rodando!' });
});

app.get('/produtos', async (req, res) =>{
   try {
        const [rows] = await db.query('SELECT id, nome, preco, imagem_url FROM produtos');
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar produtos:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar produtos.' });
    }
});

//iniciar checkout
app.post('/checkout', async (req, res) => {
    const { produtoId } = req.body;
    try{
        // Buscar o produto no banco de dados
        const [produtos] = await db.query('SELECT id, nome, preco, imagem_url FROM produtos WHERE id = ?', [produtoId]);
        if(produtos.length === 0){
            return res.status(404).json ({ error: 'Produto não encontrado.' });
        }
        const produto = produtos[0];

        // registra produto no banco como pendente
        const [pedidosResult] = await db.query(
            'INSERT INTO pedidos (total, status) VALUES (?, ?)',
            [produto.preco, 'pendente']
        );
        const pedidoId = pedidosResult.insertId;

        // Cria a preferência de pagamento no Mercado Pago
        const preference = new Preference(mpClient);
        const response = await preference.create({
            body: {
                items: [
                    {
                        id: String(produto.id),
                        title: produto.nome,
                        quantity: 1,
                        unit_price: Number(produto.preco),
                        currency_id: 'BRL'
                    }
                ],
                // Vincula o ID do nosso banco ao pagamento (essencial para o Webhook!)
                external_reference: String(pedidoId),
                back_urls: {
                    success: 'http://localhost:8090/?status=sucesso',
                    failure: 'http://localhost:8090/?status=erro',
                    pending: 'http://localhost:8090/?status=pendente'
                }
            }
        });

        // Devolve o link de pagamento para o frontend
        res.json({
            pedidoId: pedidoId,
            init_point: response.init_point,
            sandbox_init_point: response.sandbox_init_point
        });

    } catch (error) {
        console.error('Erro ao criar checkout:', error);
        res.status(500).json({ error: 'Erro ao iniciar pagamento no Mercado Pago.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});