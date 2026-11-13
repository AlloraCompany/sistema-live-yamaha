import { UpstreamError } from './errors.js';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * Chamada JSON com timeout. Classifica falhas em "pode repetir" (rede, timeout, 429, 5xx)
 * ou definitiva (4xx). Repetição fica a cargo de quem chama, que sabe se a operação é idempotente.
 */
export async function requestJson<T = unknown>(service: string, req: HttpRequest): Promise<HttpResponse<T>> {
  let res: Response;
  try {
    res = await fetch(req.url, {
      method: req.method,
      headers: {
        Accept: 'application/json',
        ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...req.headers,
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(service, `falha de rede: ${reason}`, null, true);
  }
  const text = await res.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* corpo não-JSON (ex.: HTML de erro) fica como texto */
    }
  }
  if (res.status >= 400) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new UpstreamError(service, `HTTP ${res.status}`, res.status, retryable, body);
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

/** Repete chamadas idempotentes em falhas transitórias, com backoff exponencial curto. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!(err instanceof UpstreamError) || !err.retryable || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}
