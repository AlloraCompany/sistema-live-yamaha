import { Link } from 'react-router';
import type { LiveStatus } from '@lle/shared';
import { useLive } from '../lib/live';
import { IconPlay } from './Icons';

export function LivePill({ status, small }: { status: LiveStatus | undefined; small?: boolean }) {
  const label = status === 'ao_vivo' ? 'AO VIVO' : status === 'encerrada' ? 'ENCERRADA' : 'EM BREVE';
  return (
    <span className={`pill-live ${small ? 'pill-live--sm' : ''} ${status === 'ao_vivo' ? 'pill-live--on' : 'pill-live--off'}`}>
      <span className="pill-live__dot" />
      {label}
    </span>
  );
}

/** Logo horizontal da live. As marcas Yamaha | Geração ficam só no rodapé. */
export function Brand() {
  return (
    <Link to="/" aria-label="Live Limpa Estoque, início" className="brand">
      <img src="/brand/live-limpa-estoque-horizontal.png" alt="Live Limpa Estoque" width={350} height={130} className="brand__lle" />
    </Link>
  );
}

/**
 * `sticky`: o cabeçalho (com os atalhos) fica preso no topo ao rolar, como na página da live.
 * `backToLive`: mostra o botão "Voltar à live" (o vídeo saiu da tela); o clique sobe até a transmissão.
 */
export function SiteHeader({ sticky = false, backToLive = false }: { sticky?: boolean; backToLive?: boolean }) {
  const { snapshot } = useLive();
  const goToLive = () => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  };
  return (
    <header className={`site-header ${sticky ? 'site-header--sticky' : ''} ${backToLive ? 'site-header--back' : ''}`}>
      <div className="site-header__inner">
        <div className="site-header__start">
          <Brand />
          <nav aria-label="Navegação" className="site-nav">
            <Link className="navlink" to="/#motos">
              Motos
            </Link>
            <Link className="navlink" to="/#como-funciona">
              Como funciona
            </Link>
          </nav>
        </div>
        <div className="site-header__end">
          {backToLive && (
            <button type="button" className="btn btn--primary btn--sm back-live" onClick={goToLive}>
              <IconPlay size={14} />
              Voltar à live
            </button>
          )}
          <LivePill status={snapshot?.live.status} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <img src="/brand/yamaha-white.png" alt="Yamaha" style={{ height: 24, width: 'auto' }} />
          <span />
          <img src="/brand/geracao-white.png" alt="Geração" style={{ height: 22, width: 'auto' }} />
        </div>
        <div className="site-footer__text">
          <strong>Geração Yamaha</strong> · Via Expressa · Centro · Sul da Ilha · Florianópolis/SC
          <br />
          Pagamentos processados pelo Mercado Pago · <Link to="/termo-do-voucher" style={{ color: '#C4C4C4' }}>Termo do voucher</Link>
        </div>
      </div>
    </footer>
  );
}
