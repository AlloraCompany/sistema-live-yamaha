/**
 * Carrega o catálogo do wireframe (modelos, ficha técnica, fotos, metas e lojas).
 * Idempotente: roda quantas vezes quiser; só cria o que não existe.
 *
 *   npm run seed:catalog                 → catálogo SEM estoque (unidades são cadastradas no painel)
 *   npm run seed:catalog -- --with-stock → também cadastra as quantidades do wireframe (8 / 5 / 2)
 *
 * Não cria pedidos, pagamentos nem vendas: isso só nasce de transações reais.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { createLogger } from '../src/logger.js';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-assets');
const withStock = process.argv.includes('--with-stock');

const MODELS = [
  {
    slug: 'fazer-fz25-abs',
    name: 'Fazer FZ25 ABS',
    category: 'Naked · 2026',
    colors: ['Preta', 'Cinza', 'Azul'],
    live: 2299000,
    table: 2449000,
    down: 300000,
    installment: 51900,
    rate: 'taxa a partir de 0,99% a.m.',
    specs: [
      { label: 'Motor', value: '249 cc, injeção eletrônica' },
      { label: 'Potência', value: '20,5 cv a 8.000 rpm' },
      { label: 'Freios', value: 'ABS nas duas rodas' },
      { label: 'Tanque', value: '14 litros' },
      { label: 'Peso em ordem de marcha', value: '153 kg' },
    ],
    description:
      'A naked mais vendida da loja: ágil na cidade e confortável na estrada. Painel digital, farol full LED e suspensão traseira com ajuste de pré-carga.',
    photos: [
      ['fz25-preta.webp', 'Preta'],
      ['fz25-cinza.webp', 'Cinza'],
      ['fz25-azul.webp', 'Azul'],
    ],
    stock: 8,
  },
  {
    slug: 'nmax-160-abs',
    name: 'NMAX 160 ABS',
    category: 'Scooter · 2026',
    colors: [],
    live: 2149000,
    table: 2329000,
    down: 250000,
    installment: 48500,
    rate: 'taxa a partir de 0,99% a.m.',
    specs: [],
    description: '',
    photos: [['nmax-160.webp', null]],
    stock: 5,
  },
  {
    slug: 'lander-250-abs',
    name: 'Lander 250 ABS',
    category: 'Trail · 2026',
    colors: [],
    live: 2699000,
    table: 2899000,
    down: 350000,
    installment: 60900,
    rate: 'taxa a partir de 0,99% a.m.',
    specs: [],
    description: '',
    photos: [['lander-250.webp', null]],
    stock: 2,
  },
] as const;

const GOALS = [
  [10, 'Tanque cheio', 'Todo mundo que comprou na live retira a moto com o tanque cheio.'],
  [20, 'Emplacamento grátis', 'A loja paga o emplacamento de todas as motos vendidas na live.'],
  [50, 'Capacete Yamaha', 'Cada comprador da live leva um capacete de brinde.'],
] as const;

const log = createLogger('info');
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL');
const db = createDb({ connectionString: process.env.DATABASE_URL, max: 2, ssl: process.env.DATABASE_SSL === 'true', log });
await migrate(db, log);

await db.tx(async (tx) => {
  for (const [i, m] of MODELS.entries()) {
    const { rows } = await tx.query<{ id: number; inserted: boolean }>(
      `INSERT INTO models (slug, name, category_label, colors, price_live_cents, price_table_cents, down_payment_cents,
                           installment_cents, rate_note, specs, description, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id, (xmax = 0) AS inserted`,
      [m.slug, m.name, m.category, m.colors, m.live, m.table, m.down, m.installment, m.rate, JSON.stringify(m.specs), m.description, i + 1],
    );
    const { id, inserted } = rows[0]!;
    const photos = await tx.query(`SELECT 1 FROM model_photos WHERE model_id = $1 LIMIT 1`, [id]);
    if (!photos.rowCount) {
      for (const [sort, [file, color]] of m.photos.entries()) {
        await tx.query(`INSERT INTO model_photos (model_id, color, content_type, bytes, sort) VALUES ($1, $2, 'image/webp', $3, $4)`, [
          id,
          color,
          await readFile(path.join(assets, file)),
          sort,
        ]);
      }
    }
    if (withStock) {
      const { rows: c } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM units WHERE model_id = $1 AND status <> 'removed'`, [id]);
      const missing = m.stock - c[0]!.n;
      if (missing > 0) await tx.query(`INSERT INTO units (model_id) SELECT $1 FROM generate_series(1, $2)`, [id, missing]);
    }
    log.info({ model: m.name, created: inserted }, 'modelo pronto');
  }
  for (const [threshold, prize, description] of GOALS) {
    await tx.query(`INSERT INTO goals (threshold, prize, description) VALUES ($1, $2, $3) ON CONFLICT (threshold) DO NOTHING`, [threshold, prize, description]);
  }
});
log.info({ withStock }, 'catálogo carregado');
await db.close();
