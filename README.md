# GuStore — Checkout com Mercado Pago

Loja fictícia full-stack com carrinho de compras e integração ao **Mercado Pago (Checkout Pro)** + **Webhooks** para atualização automática de pedidos no MySQL, rodando em **Docker**.

##  Stack & Serviços

- **Frontend:** HTML, JS, Bootstrap 5, Nginx → `http://localhost:8090`
- **Backend:** Node.js, Express, SDK Mercado Pago → `http://localhost:3005`
- **Banco de Dados:** MySQL (`localhost:3307`) + phpMyAdmin (`http://localhost:8085`)

##  Como Rodar

1. **Crie o `.env`** na raiz do projeto (em UTF-8) com o **Access Token de Teste** do Mercado Pago:
   ```env
   MP_ACCESS_TOKEN=TEST-seu-access-token-aqui
   WEBHOOK_URL=
   ```

2. **Suba os contêineres:**
   ```bash
   docker compose up -d --build
   ```
   *(O banco `checkout_db` e as tabelas são inicializados automaticamente via `init.sql`.)*

## Ativando o Webhook (Opcional, para atualizar status no MySQL)

1. **Exponha a porta `3005`** em um terminal dedicado:
   - **ngrok:** `npx ngrok http 3005` *(na 1ª vez rode `npx ngrok config add-authtoken SEU_TOKEN`)*
   - **Cloudflare (sem conta):** `npx cloudflared tunnel --url http://localhost:3005`

2. **Cole a URL HTTPS gerada no `.env`** (sem `/` no final) e recarregue o backend:
   ```bash
   docker compose up -d backend
   ```
   *(Sempre que reiniciar o PC com URL aleatória, repita os passos 1 e 2.)*

##  Como Testar uma Compra

1. Crie uma **Conta de Teste de Comprador** no painel do Mercado Pago Developers.
2. Em uma **Aba Anônima**, faça login em `mercadopago.com.br` com o `TESTUSER...` e senha gerados.
3. Na mesma aba, acesse `http://localhost:8090`, adicione itens ao carrinho e clique em **Finalizar Compra**.
4. Pague com o saldo fictício da conta de teste ou cartão `5031 7557 3453 0604` (CVV `123`, titular `APRO` para aprovar).
5. Confira o status atualizado para `aprovado` em `http://localhost:3005/pedidos` ou no phpMyAdmin (`http://localhost:8085`).

##  Rotas da API (`http://localhost:3005`)

| Método | Rota | Função |
| :--- | :--- | :--- |
| `GET` | `/produtos` | Lista os produtos do MySQL |
| `GET` | `/pedidos` | Lista pedidos e status atualizados |
| `POST` | `/checkout` | Cria pedido (`pendente`) e gera link do Mercado Pago |
| `POST` | `/webhook/mercadopago` | Recebe notificação do MP e atualiza o pedido no banco |

# Arquitetura
sequenceDiagram
    actor Cliente
    participant Front as Frontend (Nginx :8090)
    participant Back as Backend (Node.js :3005)
    participant DB as MySQL (:3307)
    participant MP as Mercado Pago (Checkout Pro)
    participant Tunel as Túnel HTTPS (ngrok)

    Cliente->>Front: Seleciona produtos no carrinho e clica em Finalizar
    Front->>Back: POST /checkout (IDs e quantidades)
    Back->>DB: Consulta preços reais dos produtos
    Back->>DB: Cria pedido (status: pendente) e itens
    Back->>MP: Cria preferência de pagamento (com notification_url)
    MP-->>Back: Retorna init_point (link de checkout)
    Back-->>Front: Retorna link de pagamento
    Front->>MP: Redireciona cliente para o Checkout Pro
    Cliente->>MP: Efetua pagamento (Cartão/Saldo de Teste)
    MP-->>Front: Redireciona para ?status=sucesso
    MP->>Tunel: POST /webhook/mercadopago (notificação assíncrona)
    Tunel->>Back: Encaminha Webhook para localhost:3005
    Back->>MP: GET /v1/payments/{id} (valida status oficial)
    MP-->>Back: Confirma status: approved
    Back->>DB: UPDATE pedidos SET status = 'aprovado', transacao_id = {id}

    ##  Modelo Lógico do Banco de Dados (DER)
    erDiagram
    PRODUTOS {
        int id PK
        varchar nome
        decimal preco
        varchar imagem_url
    }

    PEDIDOS {
        int id PK
        decimal total
        varchar status
        varchar transacao_id
        timestamp criado_em
    }

    PEDIDOS_ITENS {
        int id PK
        int pedido_id FK
        int produto_id FK
        int quantidade
        decimal preco_unitario
    }

    PEDIDOS ||--|{ PEDIDOS_ITENS : "contém"}
    PRODUTOS ||--o{ PEDIDOS_ITENS : "compõe"}