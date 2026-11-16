import { useEffect, useRef, useState } from 'react';
import type { AdminModel, Spec } from '@lle/shared';
import { Field, Stepper, Switch } from '../../components/Form';
import { IconPhoto, IconTrash } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

const reais = (cents: number) => (cents ? String(cents / 100) : '');
const toCents = (v: string) => Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100) || 0;

interface Draft {
  name: string;
  categoryLabel: string;
  priceLive: string;
  priceTable: string;
  downPayment: string;
  installment: string;
  installments: string;
  rateNote: string;
  colors: string;
  description: string;
  specs: Spec[];
}

function draftOf(m?: AdminModel): Draft {
  return {
    name: m?.name ?? '',
    categoryLabel: m?.categoryLabel ?? '',
    priceLive: reais(m?.priceLiveCents ?? 0),
    priceTable: reais(m?.priceTableCents ?? 0),
    downPayment: reais(m?.downPaymentCents ?? 0),
    installment: reais(m?.installmentCents ?? 0),
    installments: String(m?.installments ?? 48),
    rateNote: m?.rateNote ?? '',
    colors: (m?.colors ?? []).join(', '),
    description: m?.description ?? '',
    specs: m?.specs ?? [],
  };
}

function payloadOf(d: Draft) {
  return {
    name: d.name,
    categoryLabel: d.categoryLabel,
    priceLiveCents: toCents(d.priceLive),
    priceTableCents: toCents(d.priceTable),
    downPaymentCents: toCents(d.downPayment),
    installmentCents: toCents(d.installment),
    installments: Number(d.installments) || 48,
    rateNote: d.rateNote,
    colors: d.colors.split(',').map((c) => c.trim()).filter(Boolean),
    description: d.description,
    specs: d.specs.filter((s) => s.label.trim() && s.value.trim()),
  };
}

// Sem cadastro de chassi nem de unidade por unidade (decisão de 16/11/2026): o painel só controla quantas
// unidades estão disponíveis. Chassi e conferência da moto ficam com o gerente, no fechamento da compra.

function ModelEditor({ model, onChange }: { model?: AdminModel; onChange: () => Promise<void> }) {
  const [d, setD] = useState<Draft>(() => draftOf(model));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoColor, setPhotoColor] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const id = model ? String(model.id) : 'novo';
  const dirty = model ? JSON.stringify(payloadOf(d)) !== JSON.stringify(payloadOf(draftOf(model))) : true;

  // Atualização em tempo real não apaga o que está sendo digitado.
  useEffect(() => {
    if (!dirty) setD(draftOf(model));
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const total = model ? model.stock.available + model.stock.held + model.stock.sold : 0;

  return (
    <div className="model-edit">
      {model?.photos[0] ? <img src={model.photos[0].url} alt="" /> : <span className="ph" />}
      <div className="model-edit__body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{model ? model.name : 'Nova moto'}</span>
          {model && (
            <span className={`badge ${model.releasedAt ? 'badge--green' : ''}`}>
              {model.releasedAt ? `${model.stock.available} disponíveis` : 'Aguardando anúncio na live'}
            </span>
          )}
        </div>
        <div className="grid-4">
          <Field id={`n-${id}`} label="Nome do modelo" value={d.name} onChange={set('name')} />
          <Field id={`c-${id}`} label="Categoria / ano" placeholder="Naked · 2026" value={d.categoryLabel} onChange={set('categoryLabel')} />
          <Field id={`p-${id}`} label="Preço na live (R$)" inputMode="decimal" value={d.priceLive} onChange={set('priceLive')} />
          <Field id={`f-${id}`} label="Preço de tabela (R$)" inputMode="decimal" value={d.priceTable} onChange={set('priceTable')} />
          {model && (
            <div className="field">
              <span className="field__label">Unidades disponíveis</span>
              <Stepper
                label={`Unidades disponíveis de ${model.name}`}
                value={model.stock.available}
                disabled={busy}
                onDec={() => void run(() => adminApi.removeUnit(model.id))}
                onInc={() => void run(() => adminApi.addUnits(model.id, { quantity: 1 }))}
              />
              <span className="field__hint">
                {total} no total · {model.stock.held} em pagamento · {model.stock.sold} vendidas
              </span>
            </div>
          )}
          {model && (
            <div className="field">
              <span className="field__label">Oferta</span>
              <div style={{ height: 48, display: 'flex', alignItems: 'center' }}>
                <Switch
                  checked={model.offerActive}
                  disabled={busy}
                  label="Ativa na loja"
                  onChange={(v) => void run(() => adminApi.patchModel(model.id, { offerActive: v }))}
                />
              </div>
            </div>
          )}
          <Field id={`e-${id}`} label="Entrada (R$)" inputMode="decimal" value={d.downPayment} onChange={set('downPayment')} />
          <Field id={`x-${id}`} label={`Parcela ${d.installments}x (R$)`} inputMode="decimal" value={d.installment} onChange={set('installment')} />
        </div>
        <details className="details">
          <summary>Ficha técnica, cores e descrição</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            <div className="grid-4">
              <Field id={`cores-${id}`} label="Cores (separadas por vírgula)" value={d.colors} onChange={set('colors')} />
              <Field id={`np-${id}`} label="Nº de parcelas" inputMode="numeric" value={d.installments} onChange={set('installments')} />
              <div className="span-all" style={{ gridColumn: 'span 2' }}>
                <Field id={`tx-${id}`} label="Observação da taxa" placeholder="taxa a partir de 0,99% a.m." value={d.rateNote} onChange={set('rateNote')} />
              </div>
            </div>
            <div className="field">
              <label htmlFor={`desc-${id}`}>Descrição</label>
              <textarea id={`desc-${id}`} className="input" value={d.description} onChange={set('description')} />
            </div>
            <span className="field__label">Ficha técnica</span>
            {d.specs.map((s, i) => (
              <div key={i} className="grid-4" style={{ gridTemplateColumns: '1fr 2fr 44px' }}>
                <input className="input input--sm" aria-label="Item" placeholder="Motor" value={s.label} onChange={(e) => setD((x) => ({ ...x, specs: x.specs.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) }))} />
                <input className="input input--sm" aria-label="Valor" placeholder="249 cc, injeção eletrônica" value={s.value} onChange={(e) => setD((x) => ({ ...x, specs: x.specs.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) }))} />
                <button type="button" className="icon-btn" aria-label="Remover item" onClick={() => setD((x) => ({ ...x, specs: x.specs.filter((_, j) => j !== i) }))}>
                  <IconTrash />
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn--soft btn--sm" onClick={() => setD((x) => ({ ...x, specs: [...x.specs, { label: '', value: '' }] }))}>
                Adicionar item da ficha
              </button>
            </div>
          </div>
        </details>
        {model && (
          <div className="photos">
            {model.photos.map((p) => (
              <div key={p.id} className="photo">
                <img src={p.url} alt="" />
                {p.color && <small>{p.color}</small>}
                <button type="button" aria-label="Remover foto" onClick={() => confirm('Remover esta foto?') && void run(() => adminApi.deletePhoto(p.id))}>
                  ×
                </button>
              </div>
            ))}
            <>
              <select className="input input--sm" style={{ width: 140 }} aria-label="Cor da foto" value={photoColor} onChange={(e) => setPhotoColor(e.target.value)}>
                <option value="">Cor da foto…</option>
                {model.colors.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button type="button" className="add-photo" onClick={() => fileRef.current?.click()}>
                <IconPhoto />
                Adicionar fotos
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/webp,image/png,image/jpeg,image/avif"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  void run(async () => {
                    for (const f of files) {
                      if (f.size > 6 * 1024 * 1024) throw new ApiError(422, 'TOO_BIG', `${f.name} passa de 6 MB.`);
                      await adminApi.uploadPhoto(model.id, f, photoColor || null);
                    }
                  }, 'Fotos enviadas.');
                }}
              />
            </>
          </div>
        )}
        {msg && <div className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</div>}
        <div>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={busy || !dirty}
            onClick={() =>
              void run(async () => {
                if (model) await adminApi.patchModel(model.id, payloadOf(d));
                else {
                  await adminApi.createModel(payloadOf(d));
                  setD(draftOf());
                }
              }, model ? 'Alterações salvas: a loja já mostra os novos dados.' : 'Moto cadastrada (bloqueada). Adicione as fotos e use + para informar as unidades disponíveis.')
            }
          >
            {model ? 'Salvar alterações' : 'Cadastrar moto'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Motos, preços e fotos": catálogo, estoque físico e oferta ativa. */
export function ModelsSection({ data, onChange }: SectionProps) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="panel" id="motos">
      <div className="panel__head">
        <h2>Motos, preços e fotos</h2>
        <span>Alterações aparecem na loja na hora · a liberação fica no bloco acima</span>
        <span className="spacer" />
        <button type="button" className="btn btn--soft btn--sm" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancelar' : 'Nova moto'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {adding && <ModelEditor onChange={onChange} />}
        {data.models.map((m) => (
          <ModelEditor key={m.id} model={m} onChange={onChange} />
        ))}
      </div>
    </section>
  );
}
