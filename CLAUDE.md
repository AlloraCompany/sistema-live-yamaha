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
  - **Reserva do Pix fixa em 15 minutos** (migration 003); o campo saiu do painel e a API não altera. O Pix no
    Mercado Pago vale 30 min (mínimo de lá) e é cancelado quando a reserva vence.
  - Loja sem a frase abaixo do título; termo do voucher fala em "loja"; seção Lojas do painel sem textos de apoio.
  - **Um bloco só de motos no painel** ("Motos da live", atalho "Motos"): por moto, Liberar/Bloquear, preço na
    live, unidades disponíveis (+/−) e oferta ativa. Saíram do painel: nome, categoria, preço de tabela,
    entrada/parcela, cores, ficha técnica, descrição, fotos e "Nova moto" (vêm do cadastro por planilha; a API
    continua aceitando).
  - **Estoque total, sem "reserva"**: a operação achou confuso o botão "+1 da reserva" (testado e retirado no mesmo
    dia). Ficou só o texto "Estoque total (incluindo reserva): N" embaixo de "Unidades disponíveis"
    (migration 006, `models.stock_total`, só consulta; fica vermelho se as unidades no site passarem do total).
    O cliente nunca vê. A coluna `reserve_units` (migration 005) ficou no banco sem uso.
  - **Moto em destaque** (migration 007, `live_settings.featured_model_id`): botão "Destacar na loja" em cada
    moto do painel (uma por vez). Liberar uma moto já a coloca em destaque; bloquear ou desativar tira. Na loja o
    cartão "EM DESTAQUE AGORA NA LIVE" fica logo abaixo do vídeo, no celular e no computador (antes o celular
    destacava sozinho a última liberada).
  - **Termômetro do computador**: borda e sombra cinza (sem o contorno preto) e começando na mesma altura do
    vídeo (o título da live subiu para cima das duas colunas, `top` do `StoreLayout`).
  - **Botão "Oferta" do painel**: desativada tira a moto da loja inteira (nem com cadeado aparece); é diferente
    de Bloquear, que só fecha a compra.
  - **Metas do termômetro** (gravadas no site em 17/11, editáveis em painel → Metas): 20 motos, boné e camiseta;
    40, tanque cheio; 60, emplacamento grátis; 80, capacete.
  - **Loja sem entrada nem parcelas da moto**: isso é tratado direto na venda. "Voucher abatido da entrada" continua.
  - Descrição das motos: pegar depois do site da Yamaha e gravar no cadastro (não pelo painel).

## Estado em 16/11/2026

- **Publicado** no Fly em 16/11: app `live-yamaha-geracao` (1 máquina `shared-cpu-2x`/2 GB, `fly deploy --ha=false`),
  banco `live-yamaha-geracao-db` (Managed Postgres Basic), domínio `live.eventosyamahageracao.com` (DNS na
  Hostinger). Ainda com motos de exemplo. Mercado Pago ligado em 16/11 (aplicação "Live Limpa Estoque Yamaha", Checkout
  Transparente, API de Payments; chaves de produção no cofre do Fly; modo ensaio desligado). Plano da
  empresa: ficar no ar até sexta, 20/11. Senha do painel de produção em `.env.producao` (fora do git).
- Testado: typecheck, 78 testes. **Teste de carga contra o Fly feito em 17/11** (`apps/api/test/load/remote-load.ts`,
  resultados em `docs/TESTES.md`): 5 mil espectadores com a máquina a 14% de CPU; 1.000 compradores disputando 5 motos
  em 5,8 s, sem erro nem inconsistência. A máquina da API não foi o gargalo: **não precisa de máquina dedicada**.
  Com 5 mil ligados por 2 minutos a CPU ficou em 1% por máquina (abaixo da cota de 6,25% das compartilhadas).
- **Segunda máquina ligada em 17/11 às 19h39** (`fly scale count 2`, autorizada para 17 e 18/11, ~US$ 0,71/dia).
  **Depois da live: `fly scale count 1`** e avisar. Publicar continua sendo `fly deploy --ha=false`.
- **Limite de pedidos por IP: 100/min** desde 17/11 (`ORDER_RATE_LIMIT_PER_MINUTE` no `fly.toml`; aplicado nas duas
  máquinas com `fly machine update -e`, sem publicar código). **Limite geral da API: 3.000/min por IP**
  (`API_RATE_LIMIT_PER_MINUTE`), pelo mesmo caminho.
- **Outra conversa está mexendo no design/UX nesta mesma pasta** (17/11): não publicar nem enviar ao git sem o ok
  da operação, porque a publicação leva tudo o que estiver na pasta.
- **Voucher de volta em R$ 1.000 desde 17/11** (ficou em R$ 1 de 16 a 17/11 para o teste real de pagamento).
- **Motos reais importadas em 17/11**: 24 modelos, todos bloqueados, 103 unidades no começo e 65 de reserva
  (estoque total de 168 gravado no painel; a reserva entra com o **+** de "Unidades disponíveis"; tabela em
  `docs/estoque-da-live.md`). Estoque é só quantidade; as cores (do estoque da Geração, com nomes simplificados)
  valem só como "cor de preferência". Dados do ensaio apagados; cópias em `.data/` (fora do git). As 3 motos de
  exemplo foram apagadas do banco em 17/11 a pedido da operação (não tinham pedidos; cópia com fotos em
  `.data/motos-de-exemplo-apagadas-2026-11-17.json`).
- **Publicado em 17/11 (versões 33 a 36)**: termômetro cinza alinhado ao vídeo, moto em destaque, bloco único "Motos da live" com estoque total, loja sem
  entrada/parcelas (cópia dos dados de antes em `.data/copia-producao-2026-11-17-antes-da-reserva.json`).
  Tudo enviado ao git em 17/11 à noite (commit 2f88a06; a pasta `.claude/` fica de fora, é configuração local).
  Publicar sempre com o ok da operação (a trava do Claude barra sem ele).
- **Fotos das motos gravadas em 17/11**: 50 fotos das 24 motos, uma por cor (JPEG oficial "3/4 direita" da
  galeria de mídia da Yamaha, recortado e convertido para WebP; a operação preferiu JPEG ao PNG por ser mais leve).
  Cópias em `.data/fotos-motos/` (fora do git), com a origem de cada uma em `origem-das-fotos.tsv`. Gravadas
  direto na tabela `model_photos` (o painel não cuida de fotos). A da YZ250F 70th veio da operação pela conversa
  (pequena, 366 px de largura: trocar se mandarem o arquivo original). A Crosser Z 27 ficou só com a cor Cinza (a operação informou que só existe em Pure Grey). Fotos de outro ano-modelo, por falta do exato na galeria: Factor
  (2025), Factor DX preta (2025), Fazer 15 vermelha (2026), Crosser Z 26 vermelha (2025), WR 250 (WR250F 2023),
  R3 branca (edição 70 anos), Ténéré 700 e ZR (quadros do giro 360°). A galeria só abre na aba em que a operação
  entrou pelo portal da Yamaha (a aba precisa ser arrastada para o grupo "Claude" do Chrome).
- **Ensaio oficial em 18/11 à tarde, logo antes da live**: é no site de verdade (pagamento real). Depois do
  ensaio, rodar `ensaio:limpar` (exige status fora de "Ao vivo"; apaga pedidos, bloqueia motos, zera termômetro e
  destaque) e conferir se as unidades voltaram a 103. Cópia dos dados da véspera em
  `.data/copia-producao-2026-11-17-vespera-da-live.json`.
- **Faltam**: descrição e ficha técnica das motos (site da Yamaha), devolver pelo Mercado Pago os dois pagamentos de teste de R$ 1
  (transações 190022058102, Pix, e 189076085289, cartão), ajustar "Espectadores exibidos", conferir vídeo
  automático no celular/iPhone.
- Ajustes do designer feitos em 12/11: logo horizontal, cabeçalho fixo com "Voltar à live" na página da live, barra
  fixa de atalhos no painel, sem termômetro na reserva confirmada, seta própria nas listas.
- **Ainda em aberto com o designer e o Pedro**: cores das motos; testeira de produtos/serviços no checkout (protótipo
  `apps/web/src/components/OfferStrip.tsx`, aparece só em `npm run dev`; recomendação: mover para depois do
  pagamento e gravar o interesse para o gerente). Depoimentos e chassi já foram decididos (ver acima).

## Projeto vizinho

A landing page de cadastro e a página `/obrigado` são outro repositório (`live-limpa-estoque-yamaha`, pasta
`LP-DIVULGACAO`). A Netlify publica `captacao-live.eventosyamahageracao.com` a cada push na `main`: pedir ok antes.
