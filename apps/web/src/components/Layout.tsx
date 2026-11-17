import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { ThermoBar, Thermometer } from './Thermometer';
import { IconBack, IconCheck } from './Icons';

/**
 * Moldura das telas públicas: cabeçalho, conteúdo + termômetro lateral (desktop), rodapé e barra mobile.
 * `thermometer={false}` tira o termômetro (lateral e barra do celular), como na reserva confirmada.
 */
export function StoreLayout({
  children,
  mobileBar = true,
  thermometer = true,
  stickyHeader = false,
  backToLive = false,
  top,
}: {
  children: ReactNode;
  /** Bloco acima das duas colunas (título da live no computador): o termômetro começa junto com o vídeo. */
  top?: ReactNode;
  mobileBar?: boolean;
  thermometer?: boolean;
  /** Cabeçalho fixo no topo (página da live). */
  stickyHeader?: boolean;
  /** Mostra "Voltar à live" no cabeçalho. */
  backToLive?: boolean;
}) {
  return (
    <div className={`page ${stickyHeader ? 'page--sticky-header' : ''}`}>
      <SiteHeader sticky={stickyHeader} backToLive={backToLive} />
      {top && <div className="shell-top">{top}</div>}
      <div className="shell">
        <main className="shell__main">{children}</main>
        {thermometer && (
          <div className="shell__aside desktop-only">
            <Thermometer />
          </div>
        )}
      </div>
      <SiteFooter />
      {thermometer && mobileBar && <ThermoBar />}
    </div>
  );
}

const STEP_LABELS = ['Motos', 'Detalhes', 'Voucher', 'Concluído'];

/** Indicador de etapas do funil (1 Motos → 2 Detalhes → 3 Voucher → 4 Concluído). */
export function Steps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <div className="steps" aria-label={`Etapa ${current} de 4: ${STEP_LABELS[current - 1]}`}>
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const state = n < current || current === 4 ? 'done' : n === current ? 'current' : 'todo';
        return (
          <span key={label} style={{ display: 'contents' }}>
            {i > 0 && <span className={`step__line ${n <= current ? 'step__line--done' : ''}`} />}
            <span className={`step step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="step__dot">{state === 'done' ? <IconCheck strokeWidth={3.5} /> : n}</span>
              <span className="step__label">{label}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <div>
      <Link to={to} className="backlink">
        <IconBack />
        {children}
      </Link>
    </div>
  );
}
