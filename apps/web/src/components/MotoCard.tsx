import { Link } from 'react-router';
import { formatBRL, type PublicLive, type PublicModel } from '@lle/shared';
import { minutesAgo } from '../lib/live';
import { IconCheck, IconLock } from './Icons';

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

export function financingLine(m: PublicModel): string | null {
  if (!m.downPaymentCents || !m.installmentCents) return null;
  return `Entrada de ${formatBRL(m.downPaymentCents)} + ${m.installments}x de ${formatBRL(m.installmentCents)}`;
}

/** Card de moto da loja: liberada (com preço e compra), bloqueada (cadeado) ou esgotada. */
export function MotoCard({ m, live, now }: { m: PublicModel; live: PublicLive; now: number }) {
  const photo = m.photos[0]?.url;
  const badge = availabilityBadge(m);
  const savings = m.priceLiveCents ? m.priceTableCents - m.priceLiveCents : 0;
  const fin = financingLine(m);
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
            {fin && <div className="fin-text">{fin}</div>}
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
          <Link className="btn btn--outline btn--block" to={`/motos/${m.slug}`}>
            {m.released && m.available === 0 && m.onHold === 0 ? 'Ver detalhes e lista de espera' : 'Ver detalhes'}
          </Link>
        )}
      </div>
    </article>
  );
}
