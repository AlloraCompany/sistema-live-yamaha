import { useState } from 'react';
import { Link } from 'react-router';
import { formatBRL, type PublicLive, type PublicModel } from '@lle/shared';
import { api } from '../lib/api';
import { minutesAgo } from '../lib/live';
import { IconCheck, IconChevronRight, IconLock } from './Icons';

export function availabilityBadge(m: PublicModel): { label: string; tone: 'green' | 'yellow' | 'dark' } {
  if (m.available > 0) return { label: m.available === 1 ? 'Última unidade' : `${m.available} disponíveis`, tone: 'green' };
  if (m.onHold > 0) return { label: 'Todas em pagamento', tone: 'yellow' };
  return { label: 'Esgotada', tone: 'dark' };
}

/** Por que não dá para comprar agora: antes da live, ou depois do prazo das condições. */
export function closedSalesNote(live: PublicLive): string {
  return live.status === 'encerrada' ? 'A live terminou e o prazo das condições acabou.' : 'A compra abre quando a live estiver no ar.';
}

export function categoryLine(m: PublicModel, withColors = true): string {
  const colors = m.colors.length ? ` · ${m.colors.length} ${m.colors.length === 1 ? 'cor' : 'cores'}` : '';
  return `${m.categoryLabel}${withColors ? colors : ''}`;
}

/** Moto liberada, sem unidade livre nem em pagamento: é quando entra o botão "Eu quero!". */
export function isSoldOut(m: PublicModel): boolean {
  return m.released && m.available === 0 && m.onHold === 0;
}

const WANT_KEY = 'lle-eu-quero';
function wanted(): number[] {
  try {
    return JSON.parse(localStorage.getItem(WANT_KEY) ?? '[]') as number[];
  } catch {
    return [];
  }
}

/**
 * "Eu quero! Traz de volta na live": um toque na moto esgotada, sem pedir nome nem telefone. Soma na
 * contagem que o operador vê no painel. Cada aparelho pede uma vez por moto (fica marcado no navegador).
 */
export function WantButton({ m }: { m: PublicModel }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(() => (wanted().includes(m.id) ? 'done' : 'idle'));
  if (state === 'done') {
    return (
      <span className="btn btn--want-done btn--block" role="status">
        <IconCheck size={16} />
        Pedido enviado! Fique na live
      </span>
    );
  }
  return (
    <button
      type="button"
      className="btn btn--want btn--block"
      disabled={state === 'sending'}
      onClick={async () => {
        setState('sending');
        try {
          await api(`/api/models/${m.slug}/want`, { method: 'POST', json: {} });
          try {
            localStorage.setItem(WANT_KEY, JSON.stringify([...wanted(), m.id]));
          } catch {
            /* navegação privada: vale só para esta visita */
          }
          setState('done');
        } catch {
          setState('error');
        }
      }}
    >
      {state === 'error' ? 'Não foi agora. Toque de novo' : 'Eu quero! Traz de volta na live'}
    </button>
  );
}

/** Card de moto da loja: liberada (com preço e compra), bloqueada (cadeado) ou esgotada. */
export function MotoCard({ m, live, now }: { m: PublicModel; live: PublicLive; now: number }) {
  const photo = m.photos[0]?.url;
  const badge = availabilityBadge(m);
  const savings = m.priceLiveCents ? m.priceTableCents - m.priceLiveCents : 0;
  return (
    <article className="moto-card">
      <div className="moto-card__media">
        {photo ? <img src={photo} alt={m.name} loading="lazy" /> : <div style={{ height: 190, background: 'var(--surface)' }} />}
        {m.released ? (
          <span className="moto-card__badge">
            <span className={`badge badge--${badge.tone}`}>{badge.label}</span>
          </span>
        ) : (
          <div className="lock-overlay">
            <span className="lock-overlay__icon">
              <IconLock />
            </span>
            <span>Liberada quando for anunciada na live</span>
          </div>
        )}
      </div>
      <div className="moto-card__body">
        <div>
          <div className="kicker">{categoryLine(m)}</div>
          <div className="moto-card__name">{m.name}</div>
        </div>
        {m.priceLiveCents ? (
          <>
            <div className="price-from price-from--strike">De {formatBRL(m.priceTableCents)}</div>
            <div className="price-box">
              <span className="price-box__label">PREÇO NA LIVE</span>
              <span className="price-box__value">{formatBRL(m.priceLiveCents)}</span>
            </div>
            {savings > 0 && (
              <div>
                <span className="badge badge--green">Economia de {formatBRL(savings)} na live</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="price-from">Tabela {formatBRL(m.priceTableCents)}</div>
            <div className="price-locked">
              <IconLock size={20} />
              Preço de live revelado no anúncio
            </div>
          </>
        )}
        {m.released && m.releasedAt ? (
          <div className="released-at">
            <IconCheck />
            Liberada na live {minutesAgo(m.releasedAt, now)}
          </div>
        ) : (
          !m.released && <div className="fin-text">Fique na live: a compra abre assim que a moto for anunciada</div>
        )}
        {m.released && !live.salesOpen && <div className="fin-text">{closedSalesNote(live)}</div>}
        {m.purchasable ? (
          <Link className="btn btn--primary btn--block" to={`/motos/${m.slug}`}>
            Ver detalhes e reservar
          </Link>
        ) : (
          <div className="moto-card__actions">
            {isSoldOut(m) && <WantButton m={m} />}
            <Link className="btn btn--outline btn--block" to={`/motos/${m.slug}`}>
              Ver detalhes
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}

/** Texto do botão conforme o estado da moto (o mesmo do card grande). */
function ctaLabel(m: PublicModel): string {
  return m.purchasable ? 'Ver detalhes e reservar' : 'Ver detalhes';
}

/**
 * Moto em destaque: a que o apresentador está mostrando agora (escolhida no painel). Fica logo abaixo do vídeo,
 * no celular e no computador (`wide` = foto ao lado do texto).
 */
export function MotoFeatured({ m, wide = false }: { m: PublicModel; wide?: boolean }) {
  const photo = m.photos[0]?.url;
  const badge = availabilityBadge(m);
  const savings = m.priceLiveCents ? m.priceTableCents - m.priceLiveCents : 0;
  return (
    <Link className={`mfeat ${wide ? 'mfeat--wide' : ''}`} to={`/motos/${m.slug}`}>
      <div className="mfeat__flag">
        <i />
        EM DESTAQUE AGORA NA LIVE
      </div>
      {photo && <img src={photo} alt={m.name} />}
      <div className="mfeat__body">
        <div>
          <div className="kicker">{categoryLine(m)}</div>
          <div className="mfeat__name">{m.name}</div>
        </div>
        {m.priceLiveCents && (
          <div className="mfeat__price">
            <div>
              <small>De {formatBRL(m.priceTableCents)}</small>
              <em>PREÇO NA LIVE</em>
              <b>{formatBRL(m.priceLiveCents)}</b>
            </div>
            <div className="mfeat__tags">
              <span className={`badge badge--${badge.tone}`}>{badge.label}</span>
              {savings > 0 && <span className="badge badge--green">Economia {formatBRL(savings)}</span>}
            </div>
          </div>
        )}
        {!m.priceLiveCents && <div className="fin-text">Fique na live: o preço e a compra abrem assim que a moto for anunciada.</div>}
        <span className="btn btn--primary btn--block">{ctaLabel(m)}</span>
      </div>
    </Link>
  );
}

/** Moto liberada na lista do celular: foto ao lado, preço de live e o botão grande embaixo. */
function MotoRow({ m, live }: { m: PublicModel; live: PublicLive }) {
  const photo = m.photos[0]?.url;
  const badge = availabilityBadge(m);
  const savings = m.priceLiveCents ? m.priceTableCents - m.priceLiveCents : 0;
  const off = m.available === 0;
  const main = (
    <>
      <span className="mrow__img">{photo && <img src={photo} alt={m.name} loading="lazy" />}</span>
      <span className="mrow__tx">
        <span className={`mrow__badge mrow__badge--${badge.tone}`}>{badge.label}</span>
        <span className="mrow__name">{m.name}</span>
        {m.priceLiveCents ? (
          <>
            <span className="mrow__from">
              De <s>{formatBRL(m.priceTableCents)}</s>
              {savings > 0 && ` · economia ${formatBRL(savings)}`}
            </span>
            <span className="mrow__price">{formatBRL(m.priceLiveCents)}</span>
          </>
        ) : (
          <span className="mrow__from">Tabela {formatBRL(m.priceTableCents)}</span>
        )}
      </span>
    </>
  );
  // Esgotada: o botão é o "Eu quero!" (um toque, sem sair da lista); foto e nome levam aos detalhes.
  if (isSoldOut(m)) {
    return (
      <div className="mrow mrow--off">
        <Link className="mrow__main" to={`/motos/${m.slug}`}>
          {main}
        </Link>
        <WantButton m={m} />
      </div>
    );
  }
  return (
    <Link className={`mrow ${off ? 'mrow--off' : ''}`} to={`/motos/${m.slug}`}>
      {main}
      {!live.salesOpen && <span className="mrow__note">{closedSalesNote(live)}</span>}
      <span className={`btn ${m.purchasable ? 'btn--primary' : 'btn--outline'} btn--block`}>{ctaLabel(m)}</span>
    </Link>
  );
}

/** Moto ainda bloqueada: uma linha só (foto pequena com cadeado, nome e preço de tabela). */
function MotoLockedRow({ m }: { m: PublicModel }) {
  const photo = m.photos[0]?.url;
  return (
    <Link className="mrow mrow--lock" to={`/motos/${m.slug}`}>
      <span className="mrow__img">
        {photo && <img src={photo} alt="" loading="lazy" />}
        <span className="mrow__lock">
          <IconLock size={20} />
        </span>
      </span>
      <span className="mrow__tx">
        <span className="mrow__name">{m.name}</span>
        <span className="mrow__from">
          {m.categoryLabel} · Tabela {formatBRL(m.priceTableCents)}
        </span>
      </span>
      <span className="mrow__go">
        <IconChevronRight size={18} />
      </span>
    </Link>
  );
}

/**
 * Lista de motos no celular (aprovada em 17/11/2026): a recém-anunciada em destaque, as outras liberadas
 * em cartões deitados e as bloqueadas em linhas. Com 21 modelos, a página fica com um terço da altura.
 */
export function MotoListMobile({ models, live }: { models: PublicModel[]; live: PublicLive }) {
  const [onlyReleased, setOnlyReleased] = useState(false);
  const released = models.filter((m) => m.released);
  const locked = models.filter((m) => !m.released);
  // O destaque (moto escolhida no painel) fica logo abaixo do vídeo, na StorePage; aqui a lista segue completa.
  const rest = [...released].sort((a, b) => Number(b.available > 0) - Number(a.available > 0));
  return (
    <>
      <div className="mchips" role="group" aria-label="Filtrar motos">
        <button type="button" aria-pressed={!onlyReleased} onClick={() => setOnlyReleased(false)}>
          Todas
        </button>
        <button type="button" aria-pressed={onlyReleased} onClick={() => setOnlyReleased(true)}>
          Liberadas
        </button>
      </div>
      <div className="mlist">
        {rest.map((m) => (
          <MotoRow key={m.id} m={m} live={live} />
        ))}
        {onlyReleased && released.length === 0 && <div className="empty">Nenhuma moto liberada ainda. Fique na live!</div>}
      </div>
      {!onlyReleased && locked.length > 0 && (
        <>
          <div className="msub">
            <h3>Em breve na live · {locked.length}</h3>
            <p>Liberadas uma a uma conforme o apresentador anuncia. Toque para ver fotos e ficha técnica.</p>
          </div>
          <div className="mlist">
            {locked.map((m) => (
              <MotoLockedRow key={m.id} m={m} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
