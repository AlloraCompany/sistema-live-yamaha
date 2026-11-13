# Contexto do projeto (para continuar em outra máquina)

Sistema de vendas da **Live Limpa Estoque Yamaha | Geração**. A live acontece **uma única vez, em 18/11/2026 (quarta)**;
a hospedagem é temporária (sobe antes, fica até o prazo dos vouchers, exporta relatórios e backup, desliga).
Comece pelo [README.md](README.md) e por [docs/PUBLICACAO.md](docs/PUBLICACAO.md) (cronograma dia a dia).

## Quem usa e como falar

- Quem opera é a única pessoa no painel durante a live: libera/bloqueia motos conforme o apresentador anuncia.
  Desenvolve só sites simples: explicar em português, sem jargão, de forma curta.
- Nunca repetir senhas ou chaves na conversa (o `.env` não vai para o git).

## Decisões já tomadas (não reabrir sem pedido)

- **Painel com senha única** (`ADMIN_PASSWORD`), sem usuários/perfis.
- **Sem nota fiscal no voucher**: só comprovante com código único `LLE-XXXXXX` (UNIQUE + CHECK no banco) e nº da
  transação do Mercado Pago. A NF da moto é da loja no faturamento. Checkout sem endereço.
- **Relatório pós-live** para os gerentes: planilha .xlsx (Vendas, Devolvidos, Quase compraram, Por moto, Lista de
  espera) + PDF com um comprovante por página, por loja ou de todas.
- **Hospedagem**: Fly.io em `gru` (São Paulo), app + Managed Postgres; domínio `live.eventosyamahageracao.com`
  (subdomínio do domínio que a empresa já tem). Conta no Fly e no Mercado Pago são criadas pela empresa, não pelo Claude.
- Nenhum dado simulado apresentado como real. O dublê do Mercado Pago existe só nos testes.

## Estado em 13/11/2026

- Sistema implementado e testado (typecheck, 67 testes, carga com 10 mil conexões). Ainda **não publicado**:
  aguardando o ok da empresa para contratar Fly e Mercado Pago.
- Motos reais e acesso ao Mercado Pago chegam **segunda, 16/11** (importar com `docs/planilha-motos.xlsx`).
- Ajustes do designer feitos em 12/11: logo horizontal, cabeçalho fixo com "Voltar à live" na página da live, barra
  fixa de atalhos no painel, sem termômetro na reserva confirmada, seta própria nas listas.
- **Para segunda com o designer e o Pedro**: depoimentos "O que dizem os clientes" (usar só reais e autorizados) e
  cores das motos; testeira de produtos/serviços no checkout (protótipo `apps/web/src/components/OfferStrip.tsx`,
  aparece só em `npm run dev`; recomendação: mover para depois do pagamento e gravar o interesse para o consultor);
  quais dados das motos o painel mostra (ex.: chassi em "Reservas em tempo real").

## Projeto vizinho

A landing page de cadastro e a página `/obrigado` são outro repositório (`live-limpa-estoque-yamaha`, pasta
`LP-DIVULGACAO`). A Netlify publica `captacao-live.eventosyamahageracao.com` a cada push na `main`: pedir ok antes.
