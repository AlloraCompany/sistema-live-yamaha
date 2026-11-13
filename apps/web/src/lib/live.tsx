import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { thermometerProgress, type LiveSnapshot, type ThermometerProgress } from '@lle/shared';

interface LiveState {
  snapshot: LiveSnapshot | null;
  connected: boolean;
  error: boolean;
}

const LiveContext = createContext<LiveState>({ snapshot: null, connected: false, error: false });

/**
 * Uma única conexão SSE por aba recebe o estado da live (estoque, liberações, termômetro).
 * Se o SSE cair repetidamente (proxy corporativo, rede ruim), cai para polling do snapshot,
 * que é cacheado na CDN por 1s.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>({ snapshot: null, connected: false, error: false });

  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: number | undefined;
    let failures = 0;
    let closed = false;

    const apply = (snap: LiveSnapshot) =>
      setState((s) => (s.snapshot && s.snapshot.version >= snap.version ? { ...s, connected: true } : { snapshot: snap, connected: true, error: false }));

    const poll = async () => {
      try {
        const res = await fetch('/api/live/snapshot', { cache: 'no-cache' });
        if (res.ok) apply((await res.json()) as LiveSnapshot);
      } catch {
        setState((s) => ({ ...s, connected: false }));
      }
      if (!closed) pollTimer = window.setTimeout(poll, 4000);
    };

    const connect = () => {
      es = new EventSource('/api/live/stream');
      es.addEventListener('snapshot', (ev) => {
        failures = 0;
        apply(JSON.parse((ev as MessageEvent<string>).data) as LiveSnapshot);
      });
      es.onerror = () => {
        failures++;
        setState((s) => ({ ...s, connected: false }));
        if (failures >= 4 && es) {
          es.close();
          es = null;
          void poll();
        }
      };
    };

    // Primeira pintura rápida pelo snapshot (cacheável), depois tempo real.
    fetch('/api/live/snapshot')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: LiveSnapshot) => apply(s))
      .catch(() => setState((s) => ({ ...s, error: !s.snapshot })))
      .finally(() => {
        if (!closed) connect();
      });

    return () => {
      closed = true;
      es?.close();
      window.clearTimeout(pollTimer);
    };
  }, []);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  return useContext(LiveContext);
}

export function useThermometer(): ThermometerProgress | null {
  const { snapshot } = useLive();
  if (!snapshot) return null;
  return thermometerProgress(snapshot.sales.sold, snapshot.sales.goals);
}

/** Relógio que atualiza a cada `ms` (contagens regressivas, "há X min"). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function minutesAgo(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'há instantes';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h`;
}
