import { useState } from 'react';
import { formatBRL, formatTime } from '@lle/shared';
import { Switch } from '../../components/Form';
import { IconCheck, IconLock } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

/**
 * "Liberação das motos na live": libera e bloqueia cada moto na hora em que o apresentador anuncia.
 * Cada moto tem seu próprio botão (dá para liberar uma e bloquear outra em sequência, sem esperar);
 * o estado novo aparece no clique e é desfeito se o servidor recusar.
 */
export function ReleaseSection({ data, onChange }: SectionProps) {
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = data.models.filter((m) => m.offerActive);

  async function toggle(id: number, name: string, released: boolean) {
    setSaving((s) => ({ ...s, [id]: released }));
    setError(null);
    try {
      await adminApi.release(id, released);
      await onChange();
    } catch (err) {
      setError(`${name}: ${err instanceof ApiError ? err.message : 'falha ao salvar. Tente de novo.'}`);
    } finally {
      setSaving(({ [id]: _, ...rest }) => rest);
    }
  }

  async function bulk(fn: () => Promise<unknown>) {
    setBulkBusy(true);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar.');
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <section className="panel" id="liberacao">
      <div className="panel__head">
        <h2>Liberação das motos na live</h2>
        <span>Libere cada moto na hora em que o apresentador anunciar · a loja muda na hora para todos</span>
      </div>
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {models.map((m) => {
          const pending = saving[m.id];
          const on = pending ?? !!m.releasedAt;
          const busy = pending !== undefined || bulkBusy;
          return (
            <div key={m.id} className={`release ${on ? 'release--on' : ''}`}>
              {m.photos[0] ? <img src={m.photos[0].url} alt="" /> : <span className="ph" />}
              <div className="release__info">
                <span className="release__name">{m.name}</span>
                <span className="release__meta">
                  {m.stock.available} livres{m.stock.held ? ` · ${m.stock.held} em pagamento` : ''} · {formatBRL(m.priceLiveCents)} na live
                </span>
                <span className="release__state" aria-live="polite">
                  {on ? <IconCheck /> : <IconLock size={16} />}
                  {pending !== undefined
                    ? pending
                      ? 'Liberando…'
                      : 'Bloqueando…'
                    : on
                      ? `Liberada às ${formatTime(m.releasedAt!)} · ${m.soldInLive} ${m.soldInLive === 1 ? 'vendida' : 'vendidas'}`
                      : 'Bloqueada · na loja aparece com cadeado'}
                </span>
              </div>
              {on ? (
                <button type="button" className="btn btn--soft" disabled={busy} onClick={() => void toggle(m.id, m.name, false)}>
                  {pending === false && <span className="spinner" />}
                  Bloquear
                </button>
              ) : (
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void toggle(m.id, m.name, true)}>
                  {pending === true && <span className="spinner" />}
                  Liberar agora
                </button>
              )}
            </div>
          );
        })}
        {models.length === 0 && <div className="empty">Cadastre as motos no bloco "Motos, preços e fotos".</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn--soft btn--sm"
          disabled={bulkBusy}
          onClick={() => confirm('Liberar todas as motos agora? O preço e a compra abrem na hora para todos.') && void bulk(() => adminApi.releaseAll(true))}
        >
          Liberar todas
        </button>
        <button
          type="button"
          className="btn btn--soft btn--sm"
          disabled={bulkBusy}
          onClick={() => confirm('Bloquear todas as motos? Ninguém consegue comprar até liberar de novo.') && void bulk(() => adminApi.releaseAll(false))}
        >
          Bloquear todas
        </button>
        <Switch
          checked={data.settings.showLockedPrices}
          disabled={bulkBusy}
          label="Mostrar preço de live nas motos bloqueadas"
          onChange={(v) => void bulk(() => adminApi.patchLive({ showLockedPrices: v }))}
        />
      </div>
      <div className="small">
        Moto bloqueada aparece na loja com cadeado, sem preço de live e sem botão de compra (o cliente ainda vê fotos e ficha técnica). Quem já
        estava pagando uma moto que foi bloqueada continua com a reserva até o fim do prazo do Pix.
      </div>
    </section>
  );
}
