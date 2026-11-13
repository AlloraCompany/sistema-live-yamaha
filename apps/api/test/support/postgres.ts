import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { createDb } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { createLogger } from '../../src/logger.js';

/**
 * PostgreSQL 17 real (binário embutido) para testes e para o ambiente local.
 * Os testes de concorrência precisam do banco de verdade: SKIP LOCKED, constraints e
 * isolamento de transações não podem ser simulados.
 */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface RunningPostgres {
  baseUrl: string;
  stop: () => Promise<void>;
}

export async function startPostgres(
  opts: { fast?: boolean; maxConnections?: number; dir?: string; port?: number } = {},
): Promise<RunningPostgres> {
  const port = opts.port ?? (await freePort());
  const dir = opts.dir ?? (await mkdtemp(path.join(os.tmpdir(), 'lle-pg-')));
  const flags = ['-c', `max_connections=${opts.maxConnections ?? 400}`, '-c', 'shared_buffers=256MB'];
  // Só para testes funcionais: desliga fsync (não altera semântica de locks/transações).
  if (opts.fast) flags.push('-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off');
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: !!opts.dir,
    postgresFlags: flags,
    onLog: () => undefined,
    onError: () => undefined,
  });
  if (!opts.dir || !(await exists(path.join(dir, 'PG_VERSION')))) await server.initialise();
  await server.start();
  return {
    baseUrl: `postgres://postgres:postgres@127.0.0.1:${port}`,
    stop: async () => {
      await server.stop();
      if (!opts.dir) await rm(dir, { recursive: true, force: true });
    },
  };
}

async function exists(p: string): Promise<boolean> {
  const { access } = await import('node:fs/promises');
  return access(p).then(
    () => true,
    () => false,
  );
}

export async function createMigratedTemplate(baseUrl: string, name = 'lle_template'): Promise<void> {
  const admin = new pg.Client({ connectionString: `${baseUrl}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const log = createLogger('silent');
  const db = createDb({ connectionString: `${baseUrl}/${name}`, max: 2, log });
  await migrate(db, log);
  await db.close();
}

/** Banco novo e isolado por arquivo de teste, clonado do template já migrado (rápido). */
export async function createDatabaseFromTemplate(baseUrl: string, template = 'lle_template'): Promise<string> {
  const name = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: `${baseUrl}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
  await admin.end();
  return `${baseUrl}/${name}`;
}
