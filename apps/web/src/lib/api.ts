import type { ApiErrorBody } from '@lle/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  /** Mensagem do campo (validação 422), se houver. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as { field: string; message: string }[]) if (!out[d.field]) out[d.field] = d.message;
    }
    return out;
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; orderToken?: string } = {}): Promise<T> {
  const { json, orderToken, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(orderToken ? { 'X-Order-Token': orderToken } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão. Confira a internet e tente de novo.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? 'Algo deu errado. Tente de novo.', err?.details);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Baixa um arquivo autenticado (token do pedido no header, nunca na URL). */
export async function download(path: string, filename: string, orderToken: string): Promise<void> {
  const res = await fetch(path, { headers: { 'X-Order-Token': orderToken } });
  if (!res.ok) {
    const body = safeJson(await res.text()) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error.code ?? 'HTTP', body?.error.message ?? 'Não foi possível baixar o arquivo.');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Token aleatório gerado no navegador (identifica e dá acesso ao pedido). */
export function newClientToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ORDER_KEY = 'lle:orders';

/** Pedidos deste aparelho: código → token. */
export const orderTokens = {
  get(code: string): string | null {
    try {
      return (JSON.parse(localStorage.getItem(ORDER_KEY) ?? '{}') as Record<string, string>)[code] ?? null;
    } catch {
      return null;
    }
  },
  set(code: string, token: string): void {
    try {
      const all = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '{}') as Record<string, string>;
      all[code] = token;
      localStorage.setItem(ORDER_KEY, JSON.stringify(all));
    } catch {
      /* navegação anônima sem storage: o pedido segue acessível nesta aba */
    }
  },
  /** Pedidos feitos neste aparelho, do mais recente para o mais antigo. */
  all(): { code: string; token: string }[] {
    try {
      const all = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '{}') as Record<string, string>;
      return Object.entries(all)
        .map(([code, token]) => ({ code, token }))
        .reverse();
    } catch {
      return [];
    }
  },
};

/**
 * Reserva em andamento deste aparelho para a moto (quem gerou um Pix, voltou e tentou comprar de novo).
 * Devolve o pedido para a tela continuar o pagamento nele, em vez de só avisar que já existe uma reserva.
 */
export async function findPendingOrderHere(modelSlug: string): Promise<{ code: string; token: string } | null> {
  for (const { code, token } of orderTokens.all().slice(0, 5)) {
    try {
      const o = await api<{ status: string; model: { slug: string } }>(`/api/orders/${code}`, { orderToken: token });
      if (o.status === 'pending_payment' && o.model.slug === modelSlug) return { code, token };
    } catch {
      /* pedido antigo ou inacessível: tenta o próximo */
    }
  }
  return null;
}
