# Arquitetura

## Visão geral

```
Espectadores ──HTTPS──► CDN (opcional) ──► Balanceador (Caddy/ALB, SSE sem buffer)
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                    API (réplica 1)      API (réplica 2)  …   API (réplica N)       Fastify / Node 24
                    · loja e painel      · snapshot em memória por réplica
                    · SSE /api/live/stream (1 conexão LISTEN por réplica)
                         │                    │
                         └─────────┬──────────┘
                                   ▼
                             PostgreSQL 15+  ◄──── Worker(s): expiração, reconciliação,
                         (fonte única da verdade;     cancelamentos e estornos
                          NOTIFY a cada mudança)
                                   ▲
              Mercado Pago ──webhook──┘
```

- **Sem estado compartilhado fora do banco.** Qualquer réplica atende qualquer requisição; escalar = mais réplicas.
- **Sem Redis/fila externa.** Fila de jobs, locks e pub/sub usam o próprio Postgres (`SKIP LOCKED`,
  advisory locks, `LISTEN/NOTIFY`). Menos peças para falhar no dia da live.

## Modelo de venda (do wireframe)

O cliente compra um **voucher** (R$ 1.000, configurável) que garante o preço de live e reserva uma moto.
O valor é abatido da entrada no fechamento com o consultor ou devolvido se o crédito não for aprovado.

| Estado do pedido | Unidade física | Quando |
|---|---|---|
| `pending_payment` | `held` (segurada) | Pedido criado; Pix/cartão em andamento. Expira em `hold_minutes` (fixo em 15 min desde 17/11/2026; o Pix no MP vale 30 min, que é o mínimo de lá, e é cancelado quando a reserva vence). |
| `paid` | `sold` (baixa definitiva) | Pagamento **aprovado** no Mercado Pago. Libera o comprovante e atribui consultor. |
| `expired` / `failed` | volta a `available` | Pix não pago no prazo / cartão recusado. Cobranças abertas são canceladas. |
| `refund_pending` → `refunded` | volta a `available` | Crédito não aprovado (painel) ou pagamento tardio sem estoque. Estorno no MP. |
| `completed` | `sold` | Venda fechada com o consultor. |

## Garantias de consistência

1. **Uma moto nunca vai para dois compradores.** Cada moto física é uma linha em `units`. A reserva faz
   `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1`: compradores simultâneos pegam unidades diferentes sem fila de lock;
   sem unidade livre, a resposta é imediata. No banco: índice único `units(order_id)`, `CHECK` ligando status e
   pedido, e `UPDATE … WHERE status = 'available'` como dupla checagem.
2. **Baixa definitiva só com pagamento aprovado.** A unidade fica `held` até o MP aprovar; só então vira `sold`,
   na mesma transação que marca o pedido como pago.
3. **Reserva temporária com expiração configurável.** O worker expira reservas vencidas a cada 5 s (com
   `HOLD_GRACE_SECONDS` de tolerância para webhook atrasado) e, se uma compra encontra o estoque todo segurado,
   ela mesma libera as vencidas antes de responder "esgotado". O Pix é criado com `date_of_expiration` alinhado à
   reserva (mínimo de 30 min exigido pelo MP) e as cobranças abertas são canceladas na expiração.
4. **Idempotência ponta a ponta.**
   - Pedido: o navegador gera um token secreto; reenviar o mesmo token devolve o mesmo pedido (duplo clique, rede).
   - Mesmo CPF: advisory lock por CPF + índice único parcial `(cpf, modelo) WHERE pending` — 30 abas = 1 reserva.
   - Cobrança: `X-Idempotency-Key` determinística (`pix-<pedido>-<tentativa>`, `card-<pedido>-<tentativa>`);
     timeout na resposta do MP → nova tentativa recebe a mesma cobrança.
   - Webhook: assinatura `x-signature` validada; o corpo nunca é confiável — o status é sempre lido na API do MP
     e aplicado com lock da linha do pedido. Reenvios, ordem trocada (`date_last_updated`) e concorrência são inofensivos.
   - Pagamento: índice único `orders(paid_payment_id)`; uma segunda aprovação para o mesmo pedido gera estorno automático.
   - Código do voucher (`LLE-XXXXXX`, alfabeto sem caracteres ambíguos): `UNIQUE` + `CHECK` de formato no banco;
     colisão rara gera outro código na mesma tentativa. Nunca é reaproveitado, nem de pedidos vencidos ou devolvidos.
   - Estorno: chave `refund-<pagamento>` no MP + dedupe na fila.
5. **Pagamento tardio.** Pix aprovado depois da expiração: se houver unidade livre do mesmo modelo, a venda é
   garantida; senão, o valor é estornado automaticamente e o pedido explica o motivo.
6. **Webhook perdido.** Reconciliação a cada 30 s consulta no MP as cobranças abertas há mais de 45 s.
7. **Transações curtas e sem deadlock.** Ordem de locks fixa (pedido → unidade), `statement_timeout` e
   `idle_in_transaction_session_timeout`, repetição automática em `40001/40P01`.

Os testes de concorrência e carga verificam essas invariantes diretamente no banco depois de cada cenário.

## Tempo real (termômetro, estoque, liberações)

1. Toda mudança relevante (pedido, unidade, modelo, metas, configurações) dispara `pg_notify` por **trigger**
   (impossível esquecer no código). Notificações da mesma transação são agrupadas e só saem no `COMMIT`.
2. Cada réplica tem **uma** conexão `LISTEN`; ao ser notificada, recalcula o snapshot **uma vez** (no máximo a cada
   250 ms) e envia para todas as suas conexões SSE. O custo no banco não cresce com o número de espectadores.
3. A loja abre **uma** conexão SSE por aba (`/api/live/stream`), com reconexão automática e fallback para polling do
   snapshot (`/api/live/snapshot`, cacheável 1 s em CDN). Cliente lento é desconectado (proteção de memória).
4. O painel tem um canal SSE próprio (`orders_changed`) e recarrega os dados a cada mudança.

## Segurança

- **Comprador**: sem login; o pedido é acessado por um token aleatório de 256 bits guardado no aparelho
  (só o hash fica no banco; nunca vai na URL). CPF mascarado em todas as telas e logs.
- **Painel**: senha única (`ADMIN_PASSWORD`, 12+ caracteres), sessão opaca em cookie `HttpOnly`/`Secure`/`SameSite=Strict`,
  comparação com scrypt, 5 tentativas/min por IP (sem bloqueio de conta, que trancaria a operação para fora no meio da live),
  trocar a senha encerra todas as sessões, checagem de origem em requisições que alteram dados e trilha de
  auditoria (`audit_log`) de todas as ações.
- **Cartão**: Card Payment Brick do Mercado Pago (o número do cartão nunca passa pelos nossos servidores).
- **HTTP**: CSP restritiva, HSTS, `nosniff`, `frame-ancestors`, limite de corpo, rate limit por IP, validação de
  toda entrada com zod, SQL parametrizado.
- **Segredos**: só por variáveis de ambiente; a API recusa subir em produção sem as credenciais obrigatórias.

## Escala e capacidade

Medido nesta máquina (Apple M4, **uma** réplica da API, Postgres local com fsync; detalhes em [TESTES.md](TESTES.md)):
10.000 espectadores conectados recebem uma venda em p99 de 100 ms; 3.000 compradores simultâneos disputando
10 motos são resolvidos em ~1 s com exatamente 10 reservas; 1.500 webhooks em < 1 s sem nenhuma inconsistência.

Para produção:
- **2+ réplicas da API** (alta disponibilidade) atrás de balanceador com SSE sem buffer (Caddy incluso).
  Cada réplica comporta ~10–20 mil conexões SSE (`MAX_SSE_CLIENTS`); acima disso, mais réplicas.
- **Pool do banco**: `réplicas × DATABASE_POOL_MAX` + worker deve caber no `max_connections` (use PgBouncer se crescer).
- **CDN** (Cloudflare/CloudFront) na frente: `/assets/*` e `/media/*` são imutáveis; `/api/live/snapshot` cacheável 1 s.
- **Rate limit** é por réplica (memória). Com muitas réplicas, aplique também no balanceador/CDN (WAF).
- Fotos ficam no Postgres (servidas com cache eterno); para catálogos grandes, mover para S3/R2.

## Decisões em relação ao wireframe

- **E-mail no checkout**: exigido pelo Mercado Pago no Pix e usado para o comprovante.
- **Sem nota fiscal no voucher**: o comprovante traz o código único e a transação do Mercado Pago; a nota da moto
  sai no faturamento, pela loja.
- **Botão "Painel interno" removido do cabeçalho público** (o painel continua em `/painel`).
- **"Pagamentos simulados" removido do rodapé**: os pagamentos são reais (Mercado Pago).
- **Aceite do termo desmarcado por padrão** (consentimento ativo).
- Estados não desenhados no wireframe seguem a mesma linguagem visual: meta batida (verde, "LIBERADO"),
  esgotada / todas em pagamento, lista de espera, Pix expirado, cartão recusado, voucher devolvido.
