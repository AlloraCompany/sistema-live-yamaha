# Live Limpa Estoque Yamaha — sistema de vendas ao vivo

Loja da live (desktop e mobile), voucher de reserva com Pix e cartão (Mercado Pago), estoque com reserva
temporária e proteção contra venda dupla, termômetro de metas em tempo real, comprovante com código único,
relatório pós-live para os gerentes e
painel interno — implementados a partir do wireframe em [`wireframe/`](wireframe/).

| Documento | Conteúdo |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Componentes, fluxo da venda, garantias de consistência, tempo real e escala |
| [docs/PUBLICACAO.md](docs/PUBLICACAO.md) | Publicação no Fly.io (São Paulo) e cronograma até a live de 18/11 |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Checklist do dia da live, monitoramento e o que fazer em cada incidente |
| [docs/TESTES.md](docs/TESTES.md) | Suítes de teste, cenários de concorrência e resultados de carga |
| [.env.example](.env.example) | Todas as variáveis de ambiente, comentadas |

## Estrutura

```
apps/api          API Fastify + worker (TypeScript): pedidos, estoque, pagamentos, tempo real, painel, relatórios
  migrations/     esquema PostgreSQL (constraints garantem a consistência no banco)
  src/modules/    orders · inventory · payments · live · jobs · auth · admin · reports
  test/           testes (fluxo, painel, concorrência, carga) com Postgres real
apps/web          Loja e painel (React + Vite), estilos derivados 1:1 do wireframe
packages/shared   Contratos da API, formatação BR (R$, CPF, WhatsApp) e regras do termômetro
deploy/           Caddyfile (HTTPS + balanceamento + SSE)
wireframe/        Wireframe de alta fidelidade original
```

## Rodando localmente

Pré-requisito: Node.js 22+ (este projeto foi preparado com o Node 24 LTS em `.tools/node`, sem instalação global).

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
```

### Em outra máquina (depois de clonar)

O repositório não leva `.tools/` (Node), `.data/` (banco local), `node_modules/` nem o `.env`.

1. Instale o Node.js 22 ou mais novo (nodejs.org). Não precisa do `export PATH` acima.
2. Crie o `.env` na raiz com os valores de desenvolvimento:

   ```
   NODE_ENV=development
   LOG_LEVEL=info
   PUBLIC_BASE_URL=http://localhost:5173
   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/lle
   RUN_WORKER_IN_PROCESS=true
   COOKIE_SECURE=false
   ADMIN_PASSWORD=   (crie uma: 12+ caracteres, letras e números)
   ```

   Deixe `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` e `MP_WEBHOOK_SECRET` vazios até ter as credenciais de **teste** do
   Mercado Pago. O `npm run db:local` mostra a `DATABASE_URL` exata ao subir; use a que ele imprimir.
3. Siga os comandos abaixo a partir do `npm install` (o banco começa vazio: rode o `seed:catalog`).

```bash
npm install
```

```bash
npm run db:local
```

Em outro terminal (o `.env` local já aponta para esse Postgres; veja `.env.example`):

```bash
npm run seed:catalog -w @lle/api -- --with-stock
```

O painel usa uma **senha única**, definida em `ADMIN_PASSWORD` no `.env` (12+ caracteres, letras e números).

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Loja em http://localhost:5173 · painel em http://localhost:5173/painel.
Para testar pagamentos localmente, preencha no `.env` as **credenciais de teste** do Mercado Pago.

## Testes

```bash
npm test
```

```bash
npm run test:concurrency
```

```bash
npm run test:load
```

`npm test` roda unidade + fluxos + painel; `test:concurrency` os cenários de disputa; `test:load` sobe API real,
Postgres com fsync e milhares de conexões (`VIEWERS=10000 BUYERS=3000 npm run test:load` para o cenário maior).

## Produção

```bash
npm run build
```

- **API**: `node apps/api/dist/main.js` (N réplicas atrás de um balanceador; SSE sem buffer).
- **Worker**: `node apps/api/dist/worker-main.js` (1+ réplicas; pode escalar, o claim é com `SKIP LOCKED`).
- **Migrations**: `node apps/api/dist/migrate.js` (também rodam automaticamente na subida, com lock).
- Fly.io: `fly.toml` + `Dockerfile` (passo a passo em [docs/PUBLICACAO.md](docs/PUBLICACAO.md)).
- Alternativa com Docker: `docker-compose.yml` (Postgres, 2 réplicas da API, worker, Caddy com HTTPS; não testado).
- Catálogo pela planilha: `npm run motos:modelo -w @lle/api -- arquivo.xlsx` gera o modelo;
  `npm run motos:importar -w @lle/api -- arquivo.xlsx [--aplicar] [--desativar-outras]` importa.
- Antes da live: `npm run ensaio:limpar -w @lle/api -- --confirmar` apaga os dados do ensaio.

## O que falta configurar (credenciais e decisões externas)

1. **Mercado Pago** — `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` (produção) e, em *Suas integrações → Webhooks*,
   a URL `https://SEU_DOMINIO/api/webhooks/mercadopago` com o evento **Pagamentos**; copie a *assinatura secreta*
   para `MP_WEBHOOK_SECRET`. Habilite Pix na conta.
2. **Nota fiscal** — o voucher não tem nota própria (decisão de 12/11/2026): o cliente recebe o comprovante com o
   código único do voucher e o número da transação no Mercado Pago; a nota fiscal da moto é emitida pela loja no
   faturamento, no sistema que a concessionária já usa.
3. **Senha do painel** — `ADMIN_PASSWORD` (12+ caracteres, letras e números).
4. **Conteúdo da live** (pelo painel): link do YouTube, WhatsApp do gerente de cada loja, fotos/ficha das motos e
   unidades disponíveis (só a quantidade; o chassi é conferido pelo gerente no fechamento).
5. **Jurídico** — revisar o texto do [termo do voucher](apps/web/src/pages/TermsPage.tsx).
6. **Infra** — domínio com HTTPS, PostgreSQL gerenciado com backup e réplica, CDN (opcional, recomendado).
