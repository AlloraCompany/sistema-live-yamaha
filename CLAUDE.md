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
- Pedidos da operação em **16/11/2026**:
  - **Status da live pelo link**: sem link do YouTube fica "Em breve"; salvar um link novo coloca "Ao vivo"
    sozinho; "Encerrada" é só por clique. Com "Ao vivo" o vídeo começa sozinho (sem som).
  - **Encerrada** corta a transmissão e mostra agradecimento com contador; o site continua vendendo até
    `offers_until` (**19/11/2026 às 10h**, editável no painel).
  - **Termômetro**: não há venda de balcão; sobe com as vendas do site e tem ajuste manual (+/−) no painel.
  - **Checkout**: cliente escolhe loja e cor de preferência; o botão do comprovante abre o WhatsApp do **gerente
    da loja escolhida** (painel → Lojas) com a mensagem pronta (voucher, moto, cor). É o único telefone divulgado:
    sem WhatsApp geral e sem seção de consultores no painel (o rodízio de consultores continua no código, sem uso).
  - **Devolução do voucher fora do site**: a Geração devolve por Pix usando a planilha. Painel sem botão
    "Devolver". Ficam só os estornos automáticos de segurança (pagou depois de esgotar, pagamento duplicado).
  - **Sem chassi no site**: o painel só controla a quantidade de unidades disponíveis (+/−). Chassi e conferência
    da unidade ficam com o gerente no fechamento.
  - **Painel só para operar a live**: sem botões "Fechado"/"Devolver" nas reservas (lista só de consulta), sem
    "Válido para fechar até" (o gerente combina o prazo pelo WhatsApp), sem depoimentos na loja. O valor do voucher
    vem só do painel (nenhum "R$ 1.000" fixo no código). "Espectadores exibidos" continua manual, por escolha.
  - **Cartão**: a CSP do site libera os endereços do Mercado Pago (`*.mlstatic.com`, `*.mercadolivre.com`) e
    scripts embutidos, exigidos pelo formulário de cartão e pelo antifraude; `script-src-attr 'none'` continua.
  - Antes de qualquer recurso pago no Fly, avisar o valor e esperar o ok.
- Pedidos da operação em **17/11/2026**:
  - **Lojas**: são mais de três; o painel adiciona e remove lojas (remover só tira do checkout) e a lista sai em
    ordem alfabética. Rodapé do site, "Como funciona" e PDF usam os nomes do painel (nada fixo no código).
  - **Cliente não vê a palavra "gerente" ligada ao telefone**: no comprovante é "Falar com a loja X" e "Contato
    da loja". No painel o campo continua "WhatsApp do gerente".
  - **Loja sem data e sem "Última venda"**: o topo mostra só o selo "AO VIVO NO YOUTUBE" (o campo "Data e hora"
    saiu do painel) e o banner azul não mostra mais "Última venda há X min".
  - **Aviso do PDF** ("Valor abatido da entrada…") em texto pequeno e cinza, sem caixa azul.

## Estado em 16/11/2026

- **Publicado** no Fly em 16/11: app `live-yamaha-geracao` (1 máquina `shared-cpu-2x`/2 GB, `fly deploy --ha=false`),
  banco `live-yamaha-geracao-db` (Managed Postgres Basic), domínio `live.eventosyamahageracao.com` (DNS na
  Hostinger). Ainda com motos de exemplo. Mercado Pago ligado em 16/11 (aplicação "Live Limpa Estoque Yamaha", Checkout
  Transparente, API de Payments; chaves de produção no cofre do Fly; modo ensaio desligado). Plano da
  empresa: ficar no ar até sexta, 20/11. Senha do painel de produção em `.env.producao` (fora do git).
- Testado: typecheck, 73 testes. O teste de carga rodou só em Mac M4; **falta rodar contra o Fly** no ensaio de
  17/11 e decidir se a live usa máquina dedicada (cerca de US$ 3,50/dia).
- **ATENÇÃO**: o voucher está em **R$ 1** desde 16/11 para o teste real de pagamento. **Voltar para R$ 1.000**
  (painel → Transmissão) antes da live e conferir no ensaio de 17/11.
- **Faltam**: motos reais (serão **21 modelos diferentes**, chegam preenchidos em 17/11; importar com `docs/planilha-motos.xlsx`), devolver pelo Mercado Pago os dois pagamentos de teste de R$ 1 (Pix em 16/11 e cartão em 17/11, ambos
  aprovados de ponta a ponta), limpar os dados do ensaio (`ensaio:limpar --confirmar --apagar-pagos`), ajustar "Espectadores
  exibidos", WhatsApp do gerente de cada loja no painel, conferir vídeo automático no celular/iPhone.
- Ajustes do designer feitos em 12/11: logo horizontal, cabeçalho fixo com "Voltar à live" na página da live, barra
  fixa de atalhos no painel, sem termômetro na reserva confirmada, seta própria nas listas.
- **Ainda em aberto com o designer e o Pedro**: cores das motos; testeira de produtos/serviços no checkout (protótipo
  `apps/web/src/components/OfferStrip.tsx`, aparece só em `npm run dev`; recomendação: mover para depois do
  pagamento e gravar o interesse para o gerente). Depoimentos e chassi já foram decididos (ver acima).

## Projeto vizinho

A landing page de cadastro e a página `/obrigado` são outro repositório (`live-limpa-estoque-yamaha`, pasta
`LP-DIVULGACAO`). A Netlify publica `captacao-live.eventosyamahageracao.com` a cada push na `main`: pedir ok antes.
