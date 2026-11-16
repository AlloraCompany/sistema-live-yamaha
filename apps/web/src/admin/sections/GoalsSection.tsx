import { useEffect, useState } from 'react';
import { thermometerProgress } from '@lle/shared';
import { Stepper, Switch } from '../../components/Form';
import { IconPlus, IconTrash } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

interface Row {
  threshold: string;
  prize: string;
  description: string;
}

/** "Termômetro de metas": brindes coletivos, ajuste manual do número e visibilidade na loja. */
export function GoalsSection({ data, onChange }: SectionProps) {
  const toRows = () => data.goals.map((g) => ({ threshold: String(g.threshold), prize: g.prize, description: g.description }));
  const [rows, setRows] = useState<Row[]>(toRows);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(toRows()), [data.goals]); // eslint-disable-line react-hooks/exhaustive-deps

  const { kpis } = data;
  const p = thermometerProgress(kpis.soldInLive, data.goals);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await onChange();
      if (ok) setMsg({ ok: true, text: ok });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Falha ao salvar.' });
    } finally {
      setBusy(false);
    }
  }

  const update = (i: number, k: keyof Row) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));

  return (
    <section className="panel" id="metas">
      <div className="panel__head">
        <h2>Termômetro de metas</h2>
        <span>Brindes coletivos que a live libera conforme as vendas</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, flexWrap: 'wrap' }}>
        <div className="field">
          <span className="field__label">Na loja</span>
          <div style={{ height: 48, display: 'flex', alignItems: 'center' }}>
            <Switch
              checked={data.settings.showThermometer}
              disabled={busy}
              label="Mostrar termômetro e brindes"
              onChange={(v) => void run(() => adminApi.patchLive({ showThermometer: v }))}
            />
          </div>
        </div>
        <div className="field">
          <span className="field__label">Ajuste manual do termômetro</span>
          <Stepper
            label="Ajuste manual do termômetro"
            value={kpis.offlineSales}
            disabled={busy}
            onDec={() => void run(() => adminApi.offlineSale(-1))}
            onInc={() => void run(() => adminApi.offlineSale(1))}
          />
        </div>
        <div style={{ height: 48, display: 'flex', alignItems: 'center', fontSize: 14, color: 'var(--text)' }}>
          <span>
            <strong style={{ fontWeight: 800, color: 'var(--ink)' }}>{kpis.soldInLive}</strong> no termômetro: {kpis.soldOnSite} vendidas no site + {kpis.offlineSales}{' '}
            de ajuste manual
            {p.next && (
              <>
                {' '}
                · faltam <strong style={{ fontWeight: 800, color: 'var(--blue-700)' }}>{p.next.remaining}</strong> para {p.next.prize}
              </>
            )}
          </span>
        </div>
      </div>
      <div className="goals-grid goals-grid--head">
        <span>Motos vendidas</span>
        <span>Brinde</span>
        <span>Como funciona</span>
        <span />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r, i) => (
          <div key={i} className="goals-grid">
            <input className="input input--sm" style={{ fontWeight: 700 }} aria-label="Motos vendidas" inputMode="numeric" value={r.threshold} onChange={update(i, 'threshold')} />
            <input className="input input--sm" aria-label="Brinde" value={r.prize} onChange={update(i, 'prize')} />
            <input className="input input--sm" style={{ fontSize: 14, color: 'var(--text)' }} aria-label="Como funciona" value={r.description} onChange={update(i, 'description')} />
            <button type="button" className="icon-btn" aria-label="Remover meta" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
              <IconTrash />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--soft btn--sm" disabled={rows.length >= 8} onClick={() => setRows((x) => [...x, { threshold: '', prize: '', description: '' }])}>
          <IconPlus size={16} />
          Adicionar meta
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy}
          onClick={() =>
            void run(
              () => adminApi.saveGoals(rows.map((r) => ({ threshold: Number(r.threshold), prize: r.prize.trim(), description: r.description.trim() }))),
              'Metas salvas. O termômetro da loja já foi atualizado.',
            )
          }
        >
          Salvar metas
        </button>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</div>}
      <div className="small">
        O termômetro sobe sozinho a cada venda paga no site. Use + e − para ajustar o número na hora: quem está assistindo vê a mudança em seguida. O
        ajuste não fica abaixo de zero, então o termômetro nunca mostra menos que as vendas do site. Os brindes valem para todos os compradores da live,
        inclusive quem comprou antes de a meta ser batida.
      </div>
    </section>
  );
}
