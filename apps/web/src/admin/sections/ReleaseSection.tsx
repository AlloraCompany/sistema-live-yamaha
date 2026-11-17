import { useEffect, useState } from 'react';
import { formatTime, type AdminModel } from '@lle/shared';
import { Stepper, Switch } from '../../components/Form';
import { IconCheck, IconLock } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

const reais = (cents: number) => (cents ? String(cents / 100) : '');
const toCents = (v: string) => Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100) || 0;

// Um bloco só para a hora da live (decisão de 17/11/2026): por moto, liberar/bloquear, preço na live, unidades
// disponíveis e oferta ativa. O estoque total (contando o que ainda não foi para o site) aparece só como
// informação. Nome, categoria, preço de tabela, cores, descrição e fotos vêm do cadastro (planilha), fora do painel.
// Sem chassi (16/11): chassi e conferência da unidade ficam com o gerente, no fechamento da compra.

function MotoRow({ m, featured, bulkBusy, onChange }: { m: AdminModel; featured: boolean; bulkBusy: boolean; onChange: () => Promise<void> }) {
  // Liberar/bloquear aparece no clique e é desfeito se o servidor recusar.
  const [pending, setPending] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [price, setPrice] = useState(() => reais(m.priceLiveCents));
  const dirty = toCents(price) !== m.priceLiveCents;

  // Atualização em tempo real não apaga o que está sendo digitado.
  useEffect(() => {
    if (!dirty) setPrice(reais(m.priceLiveCents));
  }, [m.priceLiveCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const on = pending ?? !!m.releasedAt;
  const locked = busy || bulkBusy || pending !== undefined;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setMsg(null);
    try {
      await fn();
      await onChange();
      if (ok) setMsg({ ok: true, text: ok });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Falha ao salvar. Tente de novo.' });
    }
  }

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    await run(fn, ok);
    setBusy(false);
  }

  async function toggle(released: boolean) {
    setPending(released);
    await run(() => adminApi.release(m.id, released));
    setPending(undefined);
  }

  function savePrice() {
    const cents = toCents(price);
    if (cents <= 0) return setMsg({ ok: false, text: 'Informe o preço na live.' });
    void act(() => adminApi.patchModel(m.id, { priceLiveCents: cents }), 'Preço salvo: a loja já mostra o novo valor.');
  }

  const onSite = m.stock.available + m.stock.held + m.stock.sold;
  const over = m.stockTotal > 0 && onSite > m.stockTotal;
  const sold = `${m.soldInLive} ${m.soldInLive === 1 ? 'vendida' : 'vendidas'}`;
  const held = m.stock.held ? ` · ${m.stock.held} em pagamento` : '';

  return (
    <div className={`release ${on && m.offerActive ? 'release--on' : ''} ${m.offerActive ? '' : 'release--off'} ${featured ? 'release--feat' : ''}`}>
      {m.photos[0] ? <img src={m.photos[0].url} alt="" /> : <span className="ph" />}
      <div className="release__info">
        <span className="release__name">{m.name}</span>
        <span className="release__state" aria-live="polite">
          {!m.offerActive ? (
            'Oferta desativada · não aparece na loja'
          ) : (
            <>
              {on ? <IconCheck /> : <IconLock size={16} />}
              {pending !== undefined
                ? pending
                  ? 'Liberando…'
                  : 'Bloqueando…'
                : on
                  ? `Liberada às ${formatTime(m.releasedAt!)} · ${sold}${held}`
                  : `Bloqueada${m.soldInLive || m.stock.held ? ` · ${sold}${held}` : ' · na loja aparece com cadeado'}`}
            </>
          )}
        </span>
        {/* Destaque: a moto que o apresentador está mostrando agora aparece em destaque no topo da loja. */}
        {m.offerActive && (
          <span className="release__feat">
            {featured && <span className="badge badge--yellow">Em destaque na loja</span>}
            <button
              type="button"
              className="btn btn--soft btn--sm release__featbtn"
              disabled={locked}
              onClick={() => void act(() => adminApi.feature(m.id, !featured))}
            >
              {featured ? 'Tirar destaque' : 'Destacar na loja'}
            </button>
          </span>
        )}
        {msg && (
          <span className={msg.ok ? 'release__ok' : 'release__err'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </span>
        )}
      </div>
      <div className="field release__price">
        <label htmlFor={`p-${m.id}`}>Preço na live (R$)</label>
        <div className="release__price-row">
          <input
            id={`p-${m.id}`}
            className="input input--sm"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && dirty && !locked && savePrice()}
          />
          <button type="button" className="btn btn--primary btn--sm" disabled={locked || !dirty} onClick={savePrice}>
            Salvar
          </button>
        </div>
      </div>
      <div className="field release__units">
        <span className="field__label">Unidades disponíveis</span>
        <Stepper
          label={`Unidades disponíveis de ${m.name}`}
          value={m.stock.available}
          disabled={locked}
          onDec={() => void act(() => adminApi.removeUnit(m.id))}
          onInc={() => void act(() => adminApi.addUnits(m.id, { quantity: 1 }))}
        />
        {m.stockTotal > 0 && (
          <span className={`release__total ${over ? 'release__total--over' : ''}`}>
            Estoque total (incluindo reserva): <strong>{m.stockTotal}</strong>
            {over && ' · acima do total'}
          </span>
        )}
      </div>
      <div className="field release__offer">
        <span className="field__label">Oferta</span>
        <div className="release__switch">
          <Switch
            checked={m.offerActive}
            disabled={locked}
            label={m.offerActive ? 'Ativa' : 'Desativada'}
            onChange={(v) => void act(() => adminApi.patchModel(m.id, { offerActive: v }))}
          />
        </div>
      </div>
      {!m.offerActive ? (
        <button type="button" className="btn btn--soft release__action" disabled>
          Fora da loja
        </button>
      ) : on ? (
        <button type="button" className="btn btn--soft release__action" disabled={locked} onClick={() => void toggle(false)}>
          {pending === false && <span className="spinner" />}
          Bloquear
        </button>
      ) : (
        <button type="button" className="btn btn--primary release__action" disabled={locked} onClick={() => void toggle(true)}>
          {pending === true && <span className="spinner" />}
          Liberar agora
        </button>
      )}
    </div>
  );
}

/** "Motos da live": liberar e bloquear cada moto, ajustar preço na live e unidades disponíveis. */
export function ReleaseSection({ data, onChange }: SectionProps) {
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ofertas ativas primeiro; as desativadas ficam no fim, para dar para reativar.
  const models = [...data.models].sort((a, b) => Number(b.offerActive) - Number(a.offerActive));

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
        <h2>Motos da live</h2>
        <span>Libere cada moto na hora em que o apresentador anunciar · preço e unidades mudam na loja na hora</span>
      </div>
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {models.map((m) => (
          <MotoRow key={m.id} m={m} featured={data.settings.featuredModelId === m.id} bulkBusy={bulkBusy} onChange={onChange} />
        ))}
        {models.length === 0 && <div className="empty">Nenhuma moto cadastrada.</div>}
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
        Moto bloqueada aparece na loja com cadeado, sem preço de live e sem botão de compra. Quem já estava pagando uma moto que foi
        bloqueada continua com a reserva até o fim do prazo do Pix. <strong>Unidades disponíveis</strong> é o que o cliente pode comprar: use
        + para colocar mais uma à venda. O estoque total é só para consulta; o cliente não vê. <strong>Destacar na loja</strong> põe a moto
        em destaque logo abaixo do vídeo (uma por vez); liberar uma moto já a coloca em destaque e bloquear tira.
      </div>
    </section>
  );
}
