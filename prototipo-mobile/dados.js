// PROTÓTIPO: dados de exemplo, só para avaliar o desenho. Nada aqui é venda, preço ou estoque real.
const FOTO = '../apps/api/scripts/seed-assets/';
const DADOS = {
  vendidas: 7,
  assistindo: 1240,
  voucher: 'R$ 1.000',
  metas: [
    { motos: 10, brinde: 'Tanque cheio' },
    { motos: 20, brinde: 'Emplacamento grátis' },
    { motos: 50, brinde: 'Capacete Yamaha' },
  ],
  // estado: 'agora' (acabou de ser anunciada), 'liberada', 'esgotada' ou 'bloqueada'
  motos: [
    ['Fazer FZ25 ABS', 'Street', 'fz25-azul.webp', 24990, 21990, 'agora', 3],
    ['NMax 160 ABS', 'Scooter', 'nmax-160.webp', 21490, 18990, 'liberada', 2],
    ['XTZ 250 Lander ABS', 'Trail', 'lander-250.webp', 27990, 24490, 'liberada', 1],
    ['Factor 150 ED', 'Street', 'fz25-preta.webp', 17990, 15990, 'esgotada', 0],
    ['Fazer FZ15 ABS', 'Street', 'fz25-cinza.webp', 20990, 0, 'bloqueada', 0],
    ['Crosser 150 Z ABS', 'Trail', 'lander-250.webp', 22490, 0, 'bloqueada', 0],
    ['Neo 125 UBS', 'Scooter', 'nmax-160.webp', 13990, 0, 'bloqueada', 0],
    ['Fluo 125 ABS', 'Scooter', 'nmax-160.webp', 15990, 0, 'bloqueada', 0],
    ['XMax 250 ABS', 'Scooter', 'nmax-160.webp', 32990, 0, 'bloqueada', 0],
    ['MT-03 ABS', 'Street', 'fz25-preta.webp', 35990, 0, 'bloqueada', 0],
    ['YZF-R15 ABS', 'Esportiva', 'fz25-azul.webp', 23990, 0, 'bloqueada', 0],
    ['YZF-R3 ABS', 'Esportiva', 'fz25-cinza.webp', 37990, 0, 'bloqueada', 0],
    ['Factor 150 UBS', 'Street', 'fz25-preta.webp', 16990, 0, 'bloqueada', 0],
    ['Crosser 150 S ABS', 'Trail', 'lander-250.webp', 21990, 0, 'bloqueada', 0],
    ['XTZ 150 Crosser ED', 'Trail', 'lander-250.webp', 20490, 0, 'bloqueada', 0],
    ['Factor 125i UBS', 'Street', 'fz25-cinza.webp', 14990, 0, 'bloqueada', 0],
    ['NMax Connected 160', 'Scooter', 'nmax-160.webp', 22990, 0, 'bloqueada', 0],
    ['MT-07 ABS', 'Street', 'fz25-preta.webp', 52990, 0, 'bloqueada', 0],
    ['Ténéré 700', 'Trail', 'lander-250.webp', 72990, 0, 'bloqueada', 0],
    ['XMax Connected 250', 'Scooter', 'nmax-160.webp', 34990, 0, 'bloqueada', 0],
    ['MT-09 ABS', 'Street', 'fz25-azul.webp', 64990, 0, 'bloqueada', 0],
  ].map(([nome, tipo, foto, tabela, live, estado, disp]) => ({ nome, tipo, foto: FOTO + foto, tabela, live, estado, disp })),
};

const brl = (n) => 'R$ ' + n.toLocaleString('pt-BR');

/** Mesma conta do site: cada meta ocupa uma fatia igual do termômetro. */
function progresso(vendidas, metas) {
  const n = metas.length;
  let fill = 0;
  let prev = 0;
  let proxima = null;
  const lista = metas.map((m, i) => {
    const batida = vendidas >= m.motos;
    const parte = batida ? 1 : Math.max(0, (vendidas - prev) / (m.motos - prev));
    const item = { ...m, i, batida, parte: proxima ? 0 : parte, faltam: Math.max(0, m.motos - vendidas), proxima: false };
    if (!batida && !proxima) { item.proxima = true; proxima = item; }
    fill += item.parte / n;
    prev = m.motos;
    return item;
  });
  return { vendidas, metas: lista, proxima, fill: Math.min(1, fill) };
}

const ICONE = {
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="18" height="12" rx="1"/><path d="M3 13h18M12 9v12M12 9c-2-4-7-3-5 0M12 9c2-4 7-3 5 0"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/** O painel de comparação (index.html) manda a quantidade de vendas para as duas telas. */
function ouvirVendas(render) {
  const q = new URLSearchParams(location.search).get('vendidas');
  if (q !== null) DADOS.vendidas = Number(q);
  window.addEventListener('message', (e) => {
    if (e.data && typeof e.data.vendidas === 'number') { DADOS.vendidas = e.data.vendidas; render(e.data); }
    if (e.data && e.data.medir) parent.postMessage({ tela: document.body.dataset.tela, motosY: Math.round(document.getElementById('motos').getBoundingClientRect().top + scrollY) }, '*');
  });
}
