# Operação da live

## Antes da live (D-7 a D-1)

- [ ] Credenciais de **produção** do Mercado Pago no ambiente; webhook de **Pagamentos** cadastrado em
      *Suas integrações* apontando para `https://SEU_DOMINIO/api/webhooks/mercadopago`; assinatura secreta em `MP_WEBHOOK_SECRET`.
- [ ] Ensaio completo com as credenciais de teste do MP: Pix e cartão (cartões de teste), devolução de voucher, comprovante e relatório.
- [ ] Painel → **Motos da live** (atalho "Motos"): por moto, preço na live, **unidades disponíveis** (botões + e −:
      o site só vende até esse número) e oferta ativa ou não. Nome, categoria, preço de tabela, cores, descrição e
      fotos vêm do cadastro (planilha), fora do painel. O site não mostra entrada nem parcelas: isso é tratado na
      venda da moto. Não há cadastro de chassi: quem confere chassi e unidade é o gerente, no fechamento.
- [ ] Painel → **Transmissão**: link do YouTube, valor do voucher, espectadores exibidos e até quando as condições valem depois de encerrada. A reserva do Pix é fixa em 15 minutos.
- [ ] Painel → **Termômetro**: metas e brindes. → **Lojas**: nome e WhatsApp do gerente de cada loja (único telefone que o cliente recebe).
- [ ] Senha do painel (`ADMIN_PASSWORD`) forte e guardada num gerenciador de senhas; trocar a senha e reiniciar a API desconecta todos os aparelhos.
- [ ] Dados do ensaio apagados com `npm run ensaio:limpar -w @lle/api -- --confirmar` (bloqueia as motos, zera o
      termômetro e volta a live para **Em breve**; ver [PUBLICACAO.md](PUBLICACAO.md)).
- [ ] `ALLOW_START_WITHOUT_PAYMENTS` removido e credenciais de produção do Mercado Pago configuradas.
- [ ] Rodar `npm run test:load` contra um ambiente igual ao de produção (ou ao menos as suítes `npm test` e `test:concurrency`).
- [ ] Backup do banco testado; alertas configurados (abaixo).

## Durante a live

1. Cole o link da live do YouTube em **Transmissão** e salve: o status passa sozinho para **Ao vivo** (as compras
   só abrem com a live no ar). Sem link, a live fica "Em breve". O sistema não sabe se o YouTube já está
   transmitindo: ele muda quando o link é salvo.
2. Libere cada moto com **Liberar agora** no instante do anúncio e **Bloquear** quando o apresentador passar para outra.
   Cada moto tem seu botão: dá para liberar uma e bloquear outra em sequência, sem esperar. Quem já estava pagando
   uma moto que foi bloqueada mantém a reserva até o fim do prazo do Pix.
   Liberar uma moto já a coloca **em destaque** na loja (cartão "EM DESTAQUE AGORA NA LIVE", logo abaixo do
   vídeo); bloquear tira. Para destacar outra moto sem liberar ou bloquear nada, use **Destacar na loja** na linha
   dela (só uma fica em destaque por vez) e **Tirar destaque** para não deixar nenhuma.
   Na mesma linha ficam o **preço na live** (digite e clique em Salvar) e as **unidades disponíveis** (+ e −).
   Embaixo aparece "Estoque total (incluindo reserva): N": é quanto existe daquela moto ao todo, só para consulta
   (o cliente nunca vê). Para colocar mais uma unidade à venda, use o **+**. Se as unidades no site passarem do
   estoque total, o texto fica vermelho ("acima do total").
3. O termômetro sobe sozinho a cada venda paga no site. **Ajuste manual do termômetro** (+ e −) muda o número na
   hora; o ajuste não fica abaixo de zero.
4. **Reservas em tempo real** mostra cada voucher na hora, com a loja e a cor de preferência do cliente. O cliente
   recebe no comprovante o WhatsApp do gerente da loja escolhida (painel → **Lojas**), o único telefone divulgado.
5. Ao final, status **Encerrada**: a transmissão sai do ar na hora e a loja mostra o agradecimento com contador
   regressivo. As compras continuam abertas até o horário de "condições válidas no site até" (19/11 às 10h); sem
   esse horário, fecham ao encerrar.

## Depois da live

- Painel → **Relatório da live**: escolha a loja (ou todas) e baixe a **planilha** (Resumo, Vendas, Devolvidos,
  Quase compraram, Por moto e, no relatório geral, Lista de espera) e o **PDF de comprovantes** (um por página).
  O código do voucher é a chave: está na aba "Vendas", no comprovante e no pedido do cliente; a transação do
  Mercado Pago aparece ao lado para conferência. Código que não está na aba "Vendas" não é voucher válido
  (confira a aba "Devolvidos").
- "Quase compraram" lista quem gerou o Pix e não pagou, teve o cartão recusado ou pagou depois de esgotar,
  sem quem acabou comprando — os consultores podem retomar o contato.
- A devolução do voucher (crédito não aprovado ou desistência) **não passa pelo site**: a Geração devolve por Pix,
  usando a planilha para cruzar cliente, moto, comprovante e código único (decisão de 16/11/2026). O painel não tem
  botão de devolver. Continuam automáticos só os estornos de segurança: pagamento que chega depois de a moto
  esgotar e pagamento em duplicidade.

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
