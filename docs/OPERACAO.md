# Operação da live

## Antes da live (D-7 a D-1)

- [ ] Credenciais de **produção** do Mercado Pago no ambiente; webhook de **Pagamentos** cadastrado em
      *Suas integrações* apontando para `https://SEU_DOMINIO/api/webhooks/mercadopago`; assinatura secreta em `MP_WEBHOOK_SECRET`.
- [ ] Ensaio completo com as credenciais de teste do MP: Pix e cartão (cartões de teste), devolução de voucher, comprovante e relatório.
- [ ] Painel → **Motos, preços e fotos**: preços, entrada/parcela, fotos por cor, ficha técnica e **unidades físicas**
      (o estoque do site é o número de unidades cadastradas; use cor/chassi para não vender o que não existe).
- [ ] Painel → **Transmissão**: link do YouTube, data/hora, validade do voucher, WhatsApp da loja, tempo de reserva do Pix.
- [ ] Painel → **Termômetro**: metas e brindes. → **Consultores**: quem atende cada loja (com WhatsApp).
- [ ] Senha do painel (`ADMIN_PASSWORD`) forte e guardada num gerenciador de senhas; trocar a senha e reiniciar a API desconecta todos os aparelhos.
- [ ] Dados do ensaio apagados com `npm run ensaio:limpar -w @lle/api -- --confirmar` (bloqueia as motos, zera o
      termômetro e volta a live para **Em breve**; ver [PUBLICACAO.md](PUBLICACAO.md)).
- [ ] `ALLOW_START_WITHOUT_PAYMENTS` removido e credenciais de produção do Mercado Pago configuradas.
- [ ] Rodar `npm run test:load` contra um ambiente igual ao de produção (ou ao menos as suítes `npm test` e `test:concurrency`).
- [ ] Backup do banco testado; alertas configurados (abaixo).

## Durante a live

1. Status **Ao vivo** (as compras só abrem com a live no ar).
2. Libere cada moto com **Liberar agora** no instante do anúncio e **Bloquear** quando o apresentador passar para outra.
   Cada moto tem seu botão: dá para liberar uma e bloquear outra em sequência, sem esperar. Quem já estava pagando
   uma moto que foi bloqueada mantém a reserva até o fim do prazo do Pix.
3. Registre vendas de balcão/WhatsApp com **+** no termômetro.
4. **Reservas em tempo real** mostra cada voucher na hora; o consultor é atribuído automaticamente (rodízio por loja).
5. Ao final, status **Encerrada** (fecha as compras no site; quem estiver com Pix em andamento ainda pode pagar até expirar).

## Depois da live

- Painel → **Relatório da live**: escolha a loja (ou todas) e baixe a **planilha** (Resumo, Vendas, Devolvidos,
  Quase compraram, Por moto e, no relatório geral, Lista de espera) e o **PDF de comprovantes** (um por página).
  O código do voucher é a chave: está na aba "Vendas", no comprovante e no pedido do cliente; a transação do
  Mercado Pago aparece ao lado para conferência. Código que não está na aba "Vendas" não é voucher válido
  (confira a aba "Devolvidos").
- "Quase compraram" lista quem gerou o Pix e não pagou, teve o cartão recusado ou pagou depois de esgotar,
  sem quem acabou comprando — os consultores podem retomar o contato.
- Consultores fecham as vendas: **Fechado** quando a moto é faturada (a nota fiscal da moto sai pelo sistema da
  loja); **Devolver** quando o crédito não é aprovado ou o cliente desiste (estorno integral automático no Mercado
  Pago e moto de volta ao estoque).

## Monitoramento

| Sinal | Onde | Ação |
|---|---|---|
| `GET /api/ready` ≠ 200 | health check do balanceador | réplica sai do balanceamento automaticamente |
| Logs `level >= 50` (error) | coletor de logs (JSON) | investigar; jobs com falha são repetidos com backoff |
| `job falhou definitivamente` | painel → bloco **Precisa de atenção** (aparece só quando há falha) | corrigir a causa e clicar **Tentar de novo** |
| `webhook … assinatura inválida` | logs | conferir `MP_WEBHOOK_SECRET` |
| `limite de conexões SSE atingido` | logs | adicionar réplicas da API |
| Pedidos em `refund_pending` por muito tempo | painel | verificar saldo da conta MP (estornos exigem saldo) |

## Incidentes

- **Mercado Pago instável**: a reserva fica de pé e o cliente vê "tente de novo"; a reconciliação aplica os
  pagamentos assim que o MP volta. Nada a fazer além de acompanhar.
- **Banco indisponível**: a API devolve erro e não vende (nunca vende sem registrar). Ao voltar, tudo se reconecta sozinho.
- **Moto liberada por engano**: **Bloquear de novo** (reservas já pagas continuam válidas).
- **Preço errado**: corrigir no painel; pedidos já criados mantêm o preço do momento da compra (registrado no pedido).
- **Estoque físico divergente**: ajuste as unidades no painel; só unidades livres podem ser retiradas.
