# Testes

Todos os testes de integração usam **PostgreSQL 17 real** (binário embutido, banco novo por arquivo) e dublês
HTTP do Mercado Pago (`apps/api/test/support/fake-mercadopago.ts`), que reproduz o comportamento
documentado: `X-Idempotency-Key` obrigatório, expiração mínima de 30 min do Pix, cancelamento só de cobranças
abertas, estorno só de aprovadas e webhooks com `x-signature`.
Os dublês existem apenas nos testes; o código de produção não tem modo simulado.

| Comando | O que cobre |
|---|---|
| `npm test` | 11 testes do pacote compartilhado + 54 da API (unidade, fluxos HTTP, painel, planilha das motos, limpeza do ensaio) |
| `npm run test:concurrency` | 9 cenários de disputa e pagamentos simultâneos (inclui 500 compradores escolhendo cor de preferência) |
| `npm run test:load` | carga com API real em processo separado (ver abaixo) |

## Fluxos críticos (`test/orders-flow.test.ts`, `test/admin.test.ts`)

- Pix ponta a ponta: reserva → QR → webhook → pago → baixa de estoque → comprovante com o código e a transação do MP.
- Mesmo token reenviado em paralelo = mesmo pedido e mesmo Pix; mesmo CPF não segura duas motos.
- Pedido inacessível sem o token.
- Webhook com assinatura inválida → 401; 20 reenvios simultâneos = 1 venda, +1 no termômetro.
- Cartão aprovado na hora; cartão recusado libera a moto e explica o motivo; troca Pix→cartão cancela o Pix;
  Pix pago depois do cartão é estornado automaticamente.
- Reserva vencida devolve a moto e cancela o Pix; Pix pago logo após vencer garante a venda se houver estoque.
- Moto bloqueada não vende nem expõe o preço; live encerrada não vende; validação de CPF, WhatsApp, e-mail e termo.
- Esgotado vs. "todas em pagamento".
- Painel: senha única (senha errada, limite de 5 tentativas/min por IP sem bloquear a conta, troca de senha encerra
  as sessões), logout invalida sessão, liberar/bloquear refletem na loja na hora (e reserva em pagamento de moto
  bloqueada continua valendo), tarefa com falha aparece no painel e volta para a fila com um clique, venda de balcão no
  termômetro, estoque só retira unidade livre, chassi único, devolução do voucher (estorno + moto de volta +
  termômetro desce, sem estorno duplo), estorno recusado volta para a fila pelo painel, KPIs coerentes.
- Relatório pós-live: planilha com código único e transação do MP em cada venda, "quase compraram" sem quem
  acabou comprando, filtro por loja; PDF com um comprovante por venda válida. Planilha .xlsx validada nos testes
  de unidade (estrutura ZIP, CRC, abas, R$, texto escapado sem fórmulas).

## Planilha das motos e limpeza do ensaio (`test/catalog.test.ts`)

- Leitura da planilha como o Excel grava (textos compartilhados, números, aba fora de ordem), preços em vários
  formatos, erros apontados por linha; o modelo gerado tem o cabeçalho certo.
- Importação: simulação não grava; motos entram bloqueadas com as unidades por cor; repetir não muda nada; ao
  diminuir o estoque só sai unidade livre (a que está em pagamento fica e é avisada); "desativar outras".
- Limpeza do ensaio: recusa com a live "Ao vivo" e com pagamento não devolvido; depois zera pedidos, pagamentos e
  termômetro, devolve as unidades, bloqueia as motos e mantém o catálogo.

## Concorrência (`test/concurrency/stock-race.test.ts`)

| Cenário | Resultado verificado |
|---|---|
| 1.000 compradores simultâneos, 5 motos | exatamente 5 reservas, 995 "em pagamento", nenhuma moto em dois pedidos |
| Mesmo CPF em 30 abas | 1 reserva, 29 "já existe reserva" |
| Todas as reservas vencem no meio de uma rajada | as motos voltam e são vendidas na mesma rajada |
| 300 compradores, 40 motos, webhooks triplicados + expiração + pagamentos tardios + novos compradores, tudo junto | estoque fecha (vendidas = pagos, seguradas = pendentes, total = 40); todo pagamento aprovado virou venda ou foi estornado; termômetro = vendas |
| Expiração e aprovação exatamente ao mesmo tempo em 60 pedidos | cada pedido termina pago **ou** estornado, nunca os dois |
| Webhook fora de ordem | leitura antiga é descartada, a venda não é desfeita |
| Mercado Pago fora do ar | reserva mantida, nova tentativa sem segurar outra moto |
| Resposta do MP perdida (timeout) | a nova tentativa reaproveita a chave de idempotência: 1 cobrança só |

## Carga (`test/load/live-load.ts`)

Ambiente: Apple M4, **uma** réplica da API (Node 24), worker no mesmo processo, PostgreSQL 17 local com
`fsync` ligado, latência de 80 ms simulada no Mercado Pago. Espectadores chegam em ondas de 1.000 a cada 100 ms.

| Fase | 5.000 espectadores | 10.000 espectadores |
|---|---|---|
| Conexões SSE abertas | 5.000/5.000 | 10.000/10.000 |
| Venda → todos os espectadores (p50 / p99 / máx) | 27 / 45 / 45 ms | 62 / 100 / 101 ms |
| Snapshot sem CDN (200 clientes) | 44.461 req/s, p99 8,8 ms | 39.886 req/s, p99 9,5 ms |
| Rajada de compra (10 motos) | 2.000 compradores → 10 reservas, p99 786 ms | 3.000 compradores → 10 reservas, p99 1,05 s |
| Tempestade de pagamentos | 300 Pix × 3 webhooks = 900 em 404 ms, 0 erros | 500 × 3 = 1.500 em 950 ms, 0 erros |
| Termômetro após a tempestade (p99) | 240 ms | 196 ms |
| Invariantes no banco | 0 violações | 0 violações |

Relatórios completos em `tests/load/results/*.json`.

### Limites conhecidos do teste

- Gerador de carga e API rodam na mesma máquina; o macOS limita a fila de conexões pendentes a 128
  (`kern.ipc.somaxconn`). Por isso os espectadores entram em ondas e os compradores usam um pool de 512
  conexões (como um balanceador faz com o backend). Em Linux, o `backlog: 4096` da API vale até `net.core.somaxconn`.
- O teste não passa pelo Mercado Pago real nem pela internet. Antes da live, faça um ensaio em
  homologação com as credenciais de teste (ver [OPERACAO.md](OPERACAO.md)).

## Verificação manual da interface

`apps/api/test/e2e/fake-providers.ts` sobe o dublê do MP em porta fixa (4010) e um controle
(`POST :4019/pay-latest`) que simula o cliente pagando o Pix. Com uma instância da API apontada para eles
(banco separado), o fluxo completo foi percorrido no navegador: checkout → QR Code com contagem regressiva →
"Reserva confirmada" → comprovante em PDF, com o termômetro atualizando em tempo real.
