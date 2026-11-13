import type { Db } from '../../db/pool.js';
import type { Logger } from '../../logger.js';
import { RetryLater, UpstreamError } from '../../lib/errors.js';
import type { OrdersService } from '../orders/service.js';
import type { PaymentGateway } from '../payments/gateway.js';
import { paymentOutcome } from '../payments/gateway.js';
import type { JobType } from './queue.js';

interface JobRow {
  id: number;
  type: JobType;
  payload: Record<string, string>;
  attempts: number;
  max_attempts: number;
}

export interface WorkerDeps {
  db: Db;
  log: Logger;
  orders: OrdersService;
  gateway: PaymentGateway | null;
}

export interface WorkerOptions {
  pollIntervalMs?: number;
  batchSize?: number;
  expireIntervalMs?: number;
  reconcileIntervalMs?: number;
}

/**
 * Processa a fila `jobs` e roda as rotinas periódicas.
 * Vários workers podem rodar em paralelo: o claim usa FOR UPDATE SKIP LOCKED e
 * jobs "presos" (worker morreu no meio) voltam para a fila quando o lock vence.
 */
export class JobWorker {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly deps: WorkerDeps,
    private readonly opts: WorkerOptions = {},
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
      let busy = false;
      const tick = async () => {
        if (busy || !this.running) return;
        busy = true;
        const p = fn()
          .catch((err) => this.deps.log.error({ err, task: name }, 'falha em tarefa periódica'))
          .finally(() => {
            busy = false;
            this.inFlight.delete(p);
          });
        this.inFlight.add(p);
      };
      this.timers.push(setInterval(tick, ms));
      void tick();
    };
    every(this.opts.pollIntervalMs ?? 500, 'jobs', () => this.drain());
    every(this.opts.expireIntervalMs ?? 5_000, 'expire', () => this.deps.orders.expireOverdue());
    every(this.opts.reconcileIntervalMs ?? 30_000, 'reconcile', () => this.reconcile());
    every(60 * 60_000, 'housekeeping', () => this.housekeeping());
    this.deps.log.info('worker iniciado');
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await Promise.allSettled([...this.inFlight]);
  }

  /** Processa jobs prontos até a fila esvaziar (ou o worker parar). */
  async drain(maxRounds = 50): Promise<number> {
    let total = 0;
    for (let round = 0; round < maxRounds; round++) {
      const jobs = await this.claim(this.opts.batchSize ?? 10);
      if (jobs.length === 0) break;
      await Promise.all(jobs.map((j) => this.run(j)));
      total += jobs.length;
    }
    return total;
  }

  private async claim(limit: number): Promise<JobRow[]> {
    const { rows } = await this.deps.db.query<JobRow>(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = now() + interval '5 minutes', updated_at = now()
        WHERE id IN (
          SELECT id FROM jobs
           WHERE (status = 'queued' AND run_at <= now())
              OR (status = 'running' AND locked_until < now())
           ORDER BY run_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING id, type, payload, attempts, max_attempts`,
      [limit],
    );
    return rows;
  }

  private async run(job: JobRow): Promise<void> {
    const log = this.deps.log.child({ jobId: job.id, type: job.type, attempt: job.attempts });
    try {
      await this.handle(job);
      await this.deps.db.query(`UPDATE jobs SET status = 'done', locked_until = NULL, last_error = NULL, updated_at = now() WHERE id = $1`, [job.id]);
    } catch (err) {
      if (err instanceof RetryLater) {
        // Espera esperada (ex.: estorno processando no MP): não consome tentativa.
        await this.deps.db.query(
          `UPDATE jobs SET status = 'queued', attempts = attempts - 1, run_at = now() + make_interval(secs => $2),
                  locked_until = NULL, last_error = $3, updated_at = now() WHERE id = $1`,
          [job.id, err.delayMs / 1000, err.message],
        );
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof UpstreamError && !err.retryable;
      const giveUp = permanent || job.attempts >= job.max_attempts;
      const delaySec = Math.min(30 * 60, 5 * 2 ** (job.attempts - 1));
      await this.deps.db.query(
        `UPDATE jobs SET status = $2, run_at = now() + make_interval(secs => $3), locked_until = NULL,
                last_error = $4, updated_at = now() WHERE id = $1`,
        [job.id, giveUp ? 'failed' : 'queued', delaySec, message.slice(0, 2000)],
      );
      if (giveUp) log.error({ err }, 'job falhou definitivamente: requer ação manual');
      else log.warn({ err, retryInSec: delaySec }, 'job falhou, nova tentativa agendada');
    }
  }

  private async handle(job: JobRow): Promise<void> {
    const { orders, gateway } = this.deps;
    const p = job.payload;
    switch (job.type) {
      case 'payment.cancel': {
        if (!gateway) return;
        const current = await gateway.get(p.paymentId!);
        if (paymentOutcome(current.status) === 'pending') {
          try {
            await gateway.cancel(p.paymentId!);
          } catch (err) {
            if (!(err instanceof UpstreamError) || err.retryable) throw err;
            // Não cancelável (ex.: foi aprovado neste instante): o sync abaixo aplica o estado real.
          }
        }
        await orders.syncPayment(p.paymentId!, { type: 'system', id: 'payment.cancel' });
        return;
      }
      case 'payment.refund': {
        if (!gateway) return;
        const current = await gateway.get(p.paymentId!);
        if (current.status === 'approved') {
          await gateway.refund(p.paymentId!, `refund-${p.paymentId}`);
        }
        const result = await orders.syncPayment(p.paymentId!, { type: 'system', id: 'payment.refund' });
        const after = await gateway.get(p.paymentId!);
        if (after.status === 'approved') {
          // Estorno aceito mas ainda processando (comum em Pix): confere de novo depois.
          throw new RetryLater(60_000, `estorno em processamento (${result})`);
        }
        return;
      }
      default:
        throw new Error(`tipo de job desconhecido: ${job.type as string}`);
    }
  }

  /**
   * Rede de segurança para webhooks perdidos: consulta no Mercado Pago as cobranças
   * abertas há mais de 45s (as mais antigas primeiro) e aplica o estado real.
   */
  async reconcile(limit = 100): Promise<number> {
    if (!this.deps.gateway) return 0;
    const { rows } = await this.deps.db.query<{ id: string }>(
      `UPDATE payments SET updated_at = now()
        WHERE id IN (
          SELECT id FROM payments
           WHERE status IN ('pending', 'in_process', 'authorized') AND updated_at < now() - interval '45 seconds'
           ORDER BY updated_at LIMIT $1)
        RETURNING id::text`,
      [limit],
    );
    for (const r of rows) {
      try {
        await this.deps.orders.syncPayment(r.id, { type: 'system', id: 'reconcile' });
      } catch (err) {
        this.deps.log.warn({ err, paymentId: r.id }, 'reconciliação de pagamento falhou');
      }
    }
    return rows.length;
  }

  private async housekeeping(): Promise<void> {
    await this.deps.db.query(`DELETE FROM sessions WHERE expires_at < now()`);
    await this.deps.db.query(`DELETE FROM jobs WHERE status = 'done' AND updated_at < now() - interval '30 days'`);
    await this.deps.db.query(`DELETE FROM webhook_events WHERE received_at < now() - interval '90 days'`);
  }
}
