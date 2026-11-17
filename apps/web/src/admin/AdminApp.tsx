import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import './admin.css';
import { Brand, LivePill, SiteFooter } from '../components/SiteChrome';
import { Field } from '../components/Form';
import { ApiError } from '../lib/api';
import { adminApi, type Dashboard } from './adminApi';
import { Kpis } from './sections/Kpis';
import { FailedJobsSection } from './sections/FailedJobsSection';
import { ReleaseSection } from './sections/ReleaseSection';
import { BroadcastSection } from './sections/BroadcastSection';
import { GoalsSection } from './sections/GoalsSection';
import { OrdersSection } from './sections/OrdersSection';
import { ReportSection } from './sections/ReportSection';
import { StoresSection } from './sections/StoresSection';
import { WaitlistSection } from './sections/WaitlistSection';

function AdminHeader({ onLogout }: { onLogout?: () => void }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Brand />
        <nav aria-label="Navegação" className="site-nav">
          {onLogout && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onLogout}>
              Sair
            </button>
          )}
          <Link to="/" className="btn btn--outline btn--sm" target="_blank">
            Ver a loja
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Atalhos fixos no topo: a operação durante a live pula entre os blocos sem rolar a página. */
function AdminNav({ data }: { data: Dashboard | null }) {
  const failed = data?.failedJobs.length ?? 0;
  const links: { id: string; label: string; count?: number }[] = [
    { id: 'resumo', label: 'Resumo' },
    ...(failed > 0 ? [{ id: 'atencao', label: 'Atenção', count: failed }] : []),
    { id: 'liberacao', label: 'Motos' },
    { id: 'transmissao', label: 'Transmissão' },
    { id: 'metas', label: 'Metas' },
    { id: 'reservas', label: 'Reservas' },
    { id: 'espera', label: 'Eu quero', count: data?.kpis.waitlist },
    { id: 'relatorio', label: 'Relatório' },
    { id: 'lojas', label: 'Lojas' },
  ];
  const ids = links.map((l) => l.id).join(',');
  const [active, setActive] = useState('resumo');
  const bar = useRef<HTMLElement>(null);
  // Bloco escolhido no clique: fica destacado até a pessoa rolar por conta própria
  // (os blocos do fim da página não chegam ao topo, e a rolagem suave passa pelos outros).
  const chosen = useRef<string | null>(null);

  // Destaca o bloco que está no topo da tela (logo abaixo da barra).
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (chosen.current) return setActive(chosen.current);
      const limit = (bar.current?.offsetHeight ?? 56) + 24;
      let current = 'resumo';
      for (const id of ids.split(',')) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= limit) current = id;
      }
      // No fim da página, o último bloco pode não alcançar o topo.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = ids.split(',').at(-1) ?? current;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const manual = () => {
      chosen.current = null;
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    for (const ev of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(ev, manual, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      for (const ev of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(ev, manual);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids, data !== null]);

  const go = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    chosen.current = id;
    setActive(id);
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  };

  return (
    <nav ref={bar} className="admin-nav" aria-label="Blocos do painel">
      <div className="admin-nav__inner">
        <div className="admin-nav__links">
          {links.map((l) => (
            <a key={l.id} href={`#${l.id}`} className="admin-nav__link" aria-current={active === l.id ? 'true' : undefined} onClick={go(l.id)}>
              {l.label}
              {l.count ? <span className="admin-nav__count">{l.count}</span> : null}
            </a>
          ))}
        </div>
        <div className="admin-nav__status">
          {data && (
            <span className="admin-nav__sold">
              <strong>{data.kpis.soldInLive}</strong> {data.kpis.soldInLive === 1 ? 'vendida' : 'vendidas'}
            </span>
          )}
          <LivePill status={data?.settings.status} small />
        </div>
      </div>
    </nav>
  );
}

function Login({ onLogged }: { onLogged: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card login"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await adminApi.login(password);
          onLogged();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="display" style={{ fontSize: 32 }}>
        Painel <span className="hl">da live</span>
      </h1>
      <p className="small">Uso interno</p>
      {/* Campo oculto para o gerenciador de senhas do navegador associar a senha a este painel. */}
      <input type="text" name="username" autoComplete="username" value="painel" readOnly hidden />
      <Field
        id="l-pass"
        label="Senha do painel"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}
      <button className="btn btn--primary btn--block" disabled={busy}>
        {busy && <span className="spinner" />}
        Entrar
      </button>
    </form>
  );
}

export default function AdminApp() {
  const [logged, setLogged] = useState<boolean | undefined>(undefined);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const queued = useRef<Promise<void> | null>(null);

  useEffect(() => {
    adminApi
      .me()
      .then(() => setLogged(true))
      .catch(() => setLogged(false));
  }, []);

  // Uma carga por vez; pedidos feitos durante uma carga geram exatamente mais uma logo em seguida,
  // para que cliques rápidos seguidos (liberar uma moto, bloquear outra) sempre terminem com dados atuais.
  const reload = useCallback((): Promise<void> => {
    if (running.current) {
      queued.current ??= running.current.then(() => {
        queued.current = null;
        return reload();
      });
      return queued.current;
    }
    running.current = (async () => {
      try {
        setData(await adminApi.dashboard());
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setLogged(false);
        else setError(err instanceof ApiError ? err.message : 'Falha ao carregar o painel.');
      }
    })().finally(() => {
      running.current = null;
    });
    return running.current;
  }, []);

  // Tempo real: o servidor avisa a cada mudança (pedidos, estoque, liberações); o painel recarrega.
  useEffect(() => {
    if (!logged) return;
    void reload();
    const es = new EventSource('/api/admin/stream');
    es.addEventListener('changed', () => void reload());
    const safety = window.setInterval(() => void reload(), 30_000);
    return () => {
      es.close();
      window.clearInterval(safety);
    };
  }, [logged, reload]);

  const logout = async () => {
    await adminApi.logout().catch(() => undefined);
    setLogged(false);
    setData(null);
  };

  if (logged === undefined) return <div className="skeleton" style={{ height: '100vh' }} />;
  if (!logged) {
    return (
      <div className="admin">
        <AdminHeader />
        <Login onLogged={() => setLogged(true)} />
      </div>
    );
  }

  return (
    <div className="admin">
      <AdminHeader onLogout={logout} />
      <AdminNav data={data} />
      <main className="admin__main">
        <div className="admin__title" id="resumo">
          <div>
            <h1 className="display">
              Painel <span className="hl">da live</span>
            </h1>
            <p>Uso interno</p>
          </div>
        </div>
        {error && <div className="alert alert--error">{error}</div>}
        {!data ? (
          <div className="skeleton" style={{ height: 480 }} />
        ) : (
          <>
            <Kpis kpis={data.kpis} />
            <FailedJobsSection data={data} onChange={reload} />
            <ReleaseSection data={data} onChange={reload} />
            <BroadcastSection data={data} onChange={reload} />
            <GoalsSection data={data} onChange={reload} />
            <OrdersSection data={data} onChange={reload} />
            <WaitlistSection data={data} onChange={reload} />
            <ReportSection data={data} onChange={reload} />
            <StoresSection data={data} onChange={reload} />
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export type SectionProps = { data: Dashboard; onChange: () => Promise<void> };
