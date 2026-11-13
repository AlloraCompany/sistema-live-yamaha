/**
 * SOMENTE PARA TESTE E2E MANUAL/AUTOMATIZADO DA INTERFACE.
 * Sobe o dublê HTTP do Mercado Pago (porta 4010) e um controle (4019)
 * que simula o cliente pagando o Pix: aprova a cobrança e envia o webhook assinado para a API.
 *
 *   API_URL=http://127.0.0.1:3100 MP_WEBHOOK_SECRET=e2e-secret npx tsx test/e2e/fake-providers.ts
 */
import http from 'node:http';
import { FakeMercadoPago } from '../support/fake-mercadopago.js';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3100';
const SECRET = process.env.MP_WEBHOOK_SECRET ?? 'e2e-secret';

const mp = await FakeMercadoPago.start();

// Reexpõe o dublê em porta fixa (o .env do E2E aponta para elas).
function forward(port: number, target: string) {
  http
    .createServer((req, res) => {
      const up = http.request(target + req.url, { method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => res.writeHead(502).end());
      req.pipe(up);
    })
    .listen(port, '127.0.0.1');
}
forward(4010, mp.url);

http
  .createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/pay-latest') {
      const pending = [...mp.payments.values()].filter((p) => p.payment_method_id === 'pix' && p.status === 'pending').pop();
      if (!pending) return res.writeHead(404).end('nenhum Pix pendente');
      mp.approve(pending.id);
      const hook = mp.webhook(pending.id, SECRET);
      const r = await fetch(API_URL + hook.url, { method: 'POST', headers: hook.headers, body: JSON.stringify(hook.payload) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ paymentId: pending.id, webhookStatus: r.status }));
    }
    res.writeHead(404).end();
  })
  .listen(4019, '127.0.0.1');

console.log('dublê pronto: MP=4010 controle=4019');
