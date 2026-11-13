import type { ServerResponse } from 'node:http';
import pg from 'pg';
import type { Db } from '../../db/pool.js';
import type { Logger } from '../../logger.js';
import { buildSnapshot } from './snapshot.js';

/**
 * Conexão dedicada de LISTEN no Postgres, com reconexão automática.
 * Uma por instância da API, independente de quantos espectadores estejam conectados.
 */
export class PgListener {
  private client: pg.Client | null = null;
  private stopped = false;
  private retryMs = 500;

  constructor(
    private readonly connectionString: string,
    private readonly channels: string[],
    private readonly onNotify: (channel: string) => void,
    private readonly onReconnect: () => void,
    private readonly log: Logger,
    private readonly ssl = false,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      connectionString: this.connectionString,
      application_name: 'lle-listener',
      ssl: this.ssl ? { rejectUnauthorized: true } : undefined,
    });
    client.on('notification', (msg) => this.onNotify(msg.channel));
    client.on('error', (err) => {
      this.log.warn({ err }, 'conexão LISTEN caiu; reconectando');
      void this.reconnect(client);
    });
    client.on('end', () => void this.reconnect(client));
    try {
      await client.connect();
      for (const ch of this.channels) await client.query(`LISTEN ${pg.escapeIdentifier(ch)}`);
      this.client = client;
      this.retryMs = 500;
      this.onReconnect(); // pode ter perdido notificações enquanto estava desconectado
    } catch (err) {
      this.log.warn({ err }, 'falha ao conectar LISTEN');
      await client.end().catch(() => undefined);
      await this.reconnect(null);
    }
  }

  private async reconnect(old: pg.Client | null): Promise<void> {
    if (this.stopped || (old && this.client !== old)) return;
    this.client = null;
    old?.removeAllListeners();
    await old?.end().catch(() => undefined);
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 10_000);
    setTimeout(() => {
      if (!this.stopped) void this.connect();
    }, wait);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const c = this.client;
    this.client = null;
    c?.removeAllListeners();
    await c?.end().catch(() => undefined);
  }
}

/** Conjunto de conexões SSE com envio em lote e proteção contra cliente lento. */
export class SseChannel {
  private clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout;

  constructor(
    private readonly maxClients: number,
    private readonly maxBufferedBytes = 1024 * 1024,
  ) {
    // Comentário SSE periódico mantém a conexão viva em proxies/load balancers.
    this.heartbeat = setInterval(() => this.writeAll(': ping\n\n'), 20_000);
    this.heartbeat.unref();
  }

  get size(): number {
    return this.clients.size;
  }

  /** Abre o stream; devolve false se a instância já está no limite de conexões. */
  open(res: ServerResponse, initial?: string): boolean {
    if (this.clients.size >= this.maxClients) return false;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    if (initial) res.write(initial);
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
    return true;
  }

  writeAll(message: string): void {
    for (const res of this.clients) {
      if (res.writableLength > this.maxBufferedBytes) {
        // Cliente não está consumindo: derruba (o navegador reconecta e recebe o estado atual).
        this.clients.delete(res);
        res.destroy();
        continue;
      }
      res.write(message);
    }
  }

  closeAll(): void {
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}

export interface LiveHubOptions {
  /** Intervalo mínimo entre recálculos do snapshot (coalesce rajadas de vendas). */
  minIntervalMs: number;
  maxClients: number;
  safetyRefreshMs: number;
}

/**
 * Estado público da live em memória + transmissão SSE.
 * Fluxo: transação confirma → trigger faz NOTIFY → cada instância recalcula o snapshot UMA vez
 * (no máximo a cada `minIntervalMs`) → envia para todos os espectadores conectados nela.
 */
export class LiveHub {
  readonly viewers: SseChannel;
  readonly admins: SseChannel;
  private json = '';
  private snapshotVersion = 0;
  private refreshing = false;
  private dirty = false;
  private lastRefresh = 0;
  private timer: NodeJS.Timeout | null = null;
  private safety: NodeJS.Timeout | null = null;
  private adminTimer: NodeJS.Timeout | null = null;
  private versionCounter = Date.now();

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly opts: LiveHubOptions,
  ) {
    this.viewers = new SseChannel(opts.maxClients);
    this.admins = new SseChannel(500);
  }

  async start(): Promise<void> {
    await this.refreshNow();
    this.safety = setInterval(() => this.requestRefresh(), this.opts.safetyRefreshMs);
    this.safety.unref();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.safety) clearInterval(this.safety);
    if (this.adminTimer) clearTimeout(this.adminTimer);
    this.viewers.closeAll();
    this.admins.closeAll();
  }

  onNotify(channel: string): void {
    if (channel === 'live_changed') this.requestRefresh();
    // O painel também acompanha liberações/estoque feitos de outro aparelho.
    this.notifyAdmins();
  }

  /** JSON atual do snapshot (cacheável por CDN por 1s). */
  current(): { json: string; version: number } {
    return { json: this.json, version: this.snapshotVersion };
  }

  requestRefresh(): void {
    if (this.refreshing) {
      this.dirty = true;
      return;
    }
    if (this.timer) return;
    const wait = Math.max(0, this.lastRefresh + this.opts.minIntervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refreshNow();
    }, wait);
  }

  async refreshNow(): Promise<void> {
    this.refreshing = true;
    this.dirty = false;
    try {
      const version = ++this.versionCounter;
      const snap = await buildSnapshot(this.db.pool, version);
      const { version: _v, generatedAt: _g, ...comparable } = snap;
      const changed = JSON.stringify(comparable) !== this.comparable;
      if (changed || !this.json) {
        this.comparable = JSON.stringify(comparable);
        this.json = JSON.stringify(snap);
        this.snapshotVersion = version;
        this.viewers.writeAll(`id: ${version}\nevent: snapshot\ndata: ${this.json}\n\n`);
      }
    } catch (err) {
      this.log.error({ err }, 'falha ao recalcular snapshot da live');
    } finally {
      this.lastRefresh = Date.now();
      this.refreshing = false;
      if (this.dirty) this.requestRefresh();
    }
  }
  private comparable = '';

  private notifyAdmins(): void {
    if (this.adminTimer) return;
    this.adminTimer = setTimeout(() => {
      this.adminTimer = null;
      this.admins.writeAll(`event: changed\ndata: {}\n\n`);
    }, 300);
  }

  initialMessage(): string {
    return this.json ? `id: ${this.snapshotVersion}\nevent: snapshot\ndata: ${this.json}\n\n` : '';
  }
}
