import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatBRL, type PublicModel } from '@lle/shared';
import { BackLink, Steps, StoreLayout } from '../components/Layout';
import { availabilityBadge, closedSalesNote, WantButton } from '../components/MotoCard';
import { IconLock } from '../components/Icons';
import { useLive, useThermometer } from '../lib/live';
import { NotFound } from './NotFound';

function Gallery({ m }: { m: PublicModel }) {
  const [index, setIndex] = useState(0);
  const photo = m.photos[index] ?? m.photos[0];
  const label = (i: number) => m.photos[i]?.color ?? `Foto ${i + 1}`;
  return (
    <div className="gallery">
      <div className="gallery__main">
        {photo ? (
          <img src={photo.url} alt={`${m.name}${photo.color ? `, cor ${photo.color}` : ''}`} />
        ) : (
          <div style={{ height: 330, background: 'var(--surface)' }} />
        )}
        {!m.released && (
          <div className="lock-overlay">
            <span className="lock-overlay__icon">
              <IconLock />
            </span>
            <span>Liberada quando for anunciada na live</span>
          </div>
        )}
      </div>
      {m.photos.length > 1 && (
        <>
          <div className="gallery__thumbs">
            {m.photos.slice(0, 5).map((p, i) => (
              <button key={p.url} type="button" className="thumb" aria-pressed={i === index} onClick={() => setIndex(i)}>
                <img src={p.url} alt={`${m.name}, ${label(i)}`} loading="lazy" />
                <span>{label(i)}</span>
              </button>
            ))}
          </div>
          <div className="small">
            {photo?.color ? `Cor na foto: ${photo.color}. ` : ''}Toque numa miniatura para ver as outras {photo?.color ? 'cores' : 'fotos'}.
          </div>
        </>
      )}
    </div>
  );
}

export function ModelPage() {
  const { slug } = useParams();
  const { snapshot } = useLive();
  const p = useThermometer();
  if (!snapshot) return <StoreLayout>{<div className="skeleton" style={{ height: 600, marginTop: 24 }} />}</StoreLayout>;
  const m = snapshot.models.find((x) => x.slug === slug);
  if (!m) return <NotFound />;

  const badge = availabilityBadge(m);
  const savings = m.priceLiveCents ? m.priceTableCents - m.priceLiveCents : 0;
  const voucher = formatBRL(snapshot.live.voucherCents);
  const specs = [...m.specs, ...(m.colors.length ? [{ label: 'Cores', value: m.colors.join(', ') }] : [])];

  return (
    <StoreLayout>
      <Steps current={2} />
      <BackLink to="/#motos">Todas as motos</BackLink>
      <div className="two-col">
        <Gallery m={m} />
        <div className="card">
          {m.released && (
            <div>
              <span className={`badge badge--${badge.tone}`}>{badge.label}</span>
            </div>
          )}
          <div>
            <div className="kicker">{m.categoryLabel}</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.2 }}>{m.name}</h1>
          </div>
          {m.priceLiveCents ? (
            <>
              <div className="price-from price-from--strike">De {formatBRL(m.priceTableCents)}</div>
              <div className="price-box price-box--xl">
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
          {specs.length > 0 && (
            <div className="specs">
              {specs.map((s) => (
                <div key={s.label} className="row">
                  <span>{s.label}</span>
                  <span>{s.value}</span>
                </div>
              ))}
            </div>
          )}
          {m.description && <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>{m.description}</p>}

          {m.purchasable ? (
            <>
              <Link className="btn btn--primary btn--block btn--lg" to={`/motos/${m.slug}/voucher`}>
                Comprar voucher de {voucher}
              </Link>
              <div className="small center">Abatido da entrada · devolvido se o crédito não for aprovado</div>
            </>
          ) : !m.released ? (
            <div className="alert alert--info">Fique na live: a compra abre assim que a moto for anunciada.</div>
          ) : !snapshot.live.salesOpen ? (
            <div className="alert alert--info">{closedSalesNote(snapshot.live)}</div>
          ) : m.onHold > 0 ? (
            <div className="alert alert--warn">
              Todas as unidades estão seguradas para clientes pagando agora. Se algum Pix não for pago, a moto volta em minutos — esta página
              atualiza sozinha.
            </div>
          ) : (
            <>
              <div className="alert alert--warn">Esgotada nesta live. Quer que ela volte? Avise com um toque, sem cadastro.</div>
              <WantButton m={m} />
            </>
          )}

          {p && snapshot.live.showThermometer && p.goals.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Brindes da live:</span>
              {p.goals.map((g) => (
                <span key={g.id} className={`chip ${g.state === 'achieved' ? 'chip--done' : ''}`}>
                  {g.prize} · {g.state === 'achieved' ? 'liberado' : `faltam ${g.remaining}`}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

    </StoreLayout>
  );
}
