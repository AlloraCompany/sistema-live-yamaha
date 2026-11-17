// Servidor mínimo só para ver o protótipo: http://localhost:4173/prototipo-mobile/
// (serve a pasta do projeto em modo leitura, apenas neste computador)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const porta = Number(process.env.PORT) || 4173;
const raiz =fileURLToPath(new URL('..', import.meta.url));
const permitidas = ['prototipo-mobile', join('apps', 'web', 'public'), join('apps', 'web', 'src', 'styles'), join('apps', 'api', 'scripts', 'seed-assets')];
const tipos = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  let caminho = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  if (caminho === '' || caminho === 'prototipo-mobile') { res.writeHead(302, { Location: '/prototipo-mobile/' }).end(); return; }
  if (caminho.endsWith(sep)) caminho += 'index.html';
  const ok = permitidas.some((p) => caminho.startsWith(p + sep)) && tipos[extname(caminho)];
  try {
    if (!ok) throw new Error('fora do protótipo');
    const corpo = await readFile(join(raiz, caminho));
    res.writeHead(200, { 'Content-Type': tipos[extname(caminho)], 'Cache-Control': 'no-store' }).end(corpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
  }
}).listen(porta, '127.0.0.1', () => console.log(`Protótipo em http://localhost:${porta}/prototipo-mobile/`));
