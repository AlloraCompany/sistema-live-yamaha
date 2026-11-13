/**
 * PostgreSQL 17 local para desenvolvimento, sem Docker (binário embutido).
 * Os dados ficam em .data/pg na raiz do projeto. Ctrl+C encerra.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import pg from 'pg';
import { startPostgres } from '../test/support/postgres.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(root, '.data', 'pg');
await mkdir(path.dirname(dir), { recursive: true });
const server = await startPostgres({ dir, port: Number(process.env.LOCAL_PG_PORT ?? 54329) });
const admin = new pg.Client({ connectionString: `${server.baseUrl}/postgres` });
await admin.connect();
const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'lle'`);
if (!exists.rowCount) await admin.query('CREATE DATABASE lle');
await admin.end();

console.log(`\nPostgres local no ar.\n  DATABASE_URL=${server.baseUrl}/lle\n\nCtrl+C para parar.`);
const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => undefined, 1 << 30);
