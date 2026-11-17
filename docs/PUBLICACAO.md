# Publicação (Fly.io, São Paulo) e cronograma da live de 18/11

A live acontece **uma única vez**. A hospedagem é temporária: sobe antes, fica no ar até o prazo de fechamento
dos vouchers e depois é desligada, guardando relatórios e uma cópia completa do banco.

## O que fica onde

| Parte | Onde |
|---|---|
| Loja, painel e API (um pacote só, `Dockerfile`) | Fly.io, região `gru` (São Paulo), 1 máquina `shared-cpu-2x` / 2 GB (`fly.toml`) |
| Banco de dados (PostgreSQL) | Fly Managed Postgres em `gru`, plano Basic (backup automático + réplica) |
| Pagamentos | Mercado Pago |
| Vídeo | YouTube (o site só incorpora) |
| Domínio | `eventosyamahageracao.com`, onde já está registrado; só o registro `live` aponta para o Fly |

## Passo a passo

Pré-requisito: conta no Fly.io criada pela empresa (com cartão). A ferramenta `flyctl` é instalada em `.tools/`.

1. **Login (uma vez, no navegador):** `fly auth login`.
2. **App:** `fly launch --no-deploy --copy-config --name live-yamaha-geracao --region gru`
   (se o nome estiver ocupado, escolha outro e ajuste o `fly.toml`).
3. **Banco:** criar o Managed Postgres em `gru` (plano Basic) e gravar a URL **direta** (a que o Fly indica para
   `LISTEN/NOTIFY` e advisory locks) como segredo `DATABASE_URL`.
4. **Segredos:**
   - `ADMIN_PASSWORD`: senha do painel, 12+ caracteres com letras e números.
   - Antes das credenciais do Mercado Pago (ensaio): `ALLOW_START_WITHOUT_PAYMENTS=true`.
5. **Publicar:** `fly deploy --ha=false` (uma máquina só; sem a opção, a primeira publicação cria duas). As
   migrations rodam sozinhas na subida. Publicado em 16/11/2026: app `live-yamaha-geracao`, banco
   `live-yamaha-geracao-db`. Segredo inválido (ex.: `ADMIN_PASSWORD` fora da regra) derruba o site: com uma
   máquina não há versão anterior no ar.
6. **Domínio:** `fly certs add live.eventosyamahageracao.com` e criar no painel do domínio o registro que o Fly
   mostrar (CNAME `live` → `live-yamaha-geracao.fly.dev`, ou A/AAAA). Plano B enquanto o DNS não propaga:
   `https://live-yamaha-geracao.fly.dev` (atualizar `PUBLIC_BASE_URL` se for usar esse endereço).
7. **Catálogo do ensaio:** motos de exemplo com `npm run seed:catalog -w @lle/api -- --with-stock`, usando o
   `DATABASE_URL` do banco do Fly (via `fly proxy` / `fly mpg proxy`).

## Segunda (16/11): motos reais e Mercado Pago

1. Preencher `docs/planilha-motos.xlsx` (aba "Motos"; regras na aba "Como preencher").
2. Conferir e importar:
   - `npm run motos:importar -w @lle/api -- docs/planilha-motos.xlsx` mostra o que mudaria;
   - repetir com `--aplicar --desativar-outras` para gravar e tirar as motos de exemplo da loja.
3. Fotos de cada moto: o painel não cuida mais de fotos (17/11); são gravadas direto no cadastro, uma por cor,
   em WebP (cópias e origem em `.data/fotos-motos/`).
4. Mercado Pago:
   - `fly secrets set MP_ACCESS_TOKEN=… MP_PUBLIC_KEY=… MP_WEBHOOK_SECRET=…`;
   - `fly secrets unset ALLOW_START_WITHOUT_PAYMENTS`;
   - webhook de **Pagamentos** cadastrado em `https://live.eventosyamahageracao.com/api/webhooks/mercadopago`.
5. Teste real de R$ 1:
   - painel → Transmissão → valor do voucher R$ 1;
   - comprar com cartão/Pix próprio e conferir comprovante e relatório;
   - devolver o R$ 1 pelo painel do Mercado Pago (o site não devolve voucher; o sistema recebe o aviso do estorno
     e libera a unidade);
   - voltar o voucher para R$ 1.000.

## Terça (17/11): ensaio geral e limpeza

1. Ensaio completo (liberar/bloquear, termômetro e ajuste manual, encerramento com contador, relatório), no computador e no celular
   (inclusive iPhone).
2. **Limpar os dados do ensaio** (mantém motos, fotos, preços, estoque, metas, consultores e configurações):
   - `npm run ensaio:limpar -w @lle/api` mostra o que seria apagado;
   - repetir com `--confirmar` para apagar;
   - se houver pagamentos de **teste** ou já devolvidos, acrescentar `--apagar-pagos`.

   O comando recusa rodar com a live "Ao vivo".
3. Conferir: motos bloqueadas, termômetro em 0, live "Em breve", voucher R$ 1.000. Não mexer mais no código.

## Quarta (18/11): dia da live

- De manhã, reforço: `fly scale count 2` (duas máquinas atrás do balanceador do Fly).
- Ao terminar, volta para `fly scale count 1`.

## Depois da live: encerramento

1. As compras no site fecham em 19/11 às 10h (prazo das condições). A devolução de voucher é feita pela Geração,
   por Pix, fora do site.
2. Baixar o relatório final (planilha + PDF de comprovantes) de todas as lojas.
3. Baixar uma cópia completa do banco (`pg_dump` do PostgreSQL 17 via `fly mpg proxy`; a ferramenta não vem com o
   Postgres local deste projeto e é instalada na hora) e guardar com a empresa.
4. Apagar o app e o banco no Fly (`fly apps destroy`, e o cluster no painel do Fly). A cobrança para.
