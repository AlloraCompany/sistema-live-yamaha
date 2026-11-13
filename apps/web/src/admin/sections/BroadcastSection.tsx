import { useEffect, useState } from 'react';
import { formatBrPhone, type LiveStatus, type Testimonial } from '@lle/shared';
import { Field } from '../../components/Form';
import { IconTrash } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

const STATUS: [LiveStatus, string][] = [
  ['em_breve', 'Em breve'],
  ['ao_vivo', 'Ao vivo'],
  ['encerrada', 'Encerrada'],
];

/** ISO → valor do <input type="datetime-local"> no horário de Brasília. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}
function fromLocalInput(v: string): string | null {
  return v ? `${v}:00-03:00` : null;
}

/** "Transmissão": o que o cliente vê no topo da página. */
export function BroadcastSection({ data, onChange }: SectionProps) {
  const s = data.settings;
  const [form, setForm] = useState(() => init());
  const [testimonials, setTestimonials] = useState<Testimonial[]>(s.testimonials);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function init() {
    return {
      startsAt: toLocalInput(s.startsAt),
      viewers: String(s.viewers),
      youtubeUrl: s.youtubeUrl ?? '',
      voucher: String(s.voucherCents / 100),
      validUntil: s.validUntil ?? '',
      whatsapp: s.whatsapp ? formatBrPhone(s.whatsapp) : '',
      holdMinutes: String(s.holdMinutes),
    };
  }
  useEffect(() => setTestimonials(s.testimonials), [s.testimonials]);

  async function save(patch: Parameters<typeof adminApi.patchLive>[0], okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.patchLive(patch);
      await onChange();
      setMsg({ ok: true, text: okText });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Falha ao salvar.' });
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section className="panel" id="transmissao">
      <div className="panel__head">
        <h2>Transmissão</h2>
        <span>O que o cliente vê no topo da página</span>
      </div>
      <div className="grid-3">
        <div className="field">
          <span className="field__label">Status da live</span>
          <div role="group" aria-label="Status da live" className="status-seg">
            {STATUS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={s.status === value}
                disabled={busy}
                onClick={() => {
                  if (value === 'encerrada' && !confirm('Encerrar a live? As compras no site fecham na hora.')) return;
                  void save({ status: value }, `Status alterado para "${label}".`);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Field id="p-date" label="Data e hora" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
        <Field id="p-view" label="Espectadores exibidos" inputMode="numeric" value={form.viewers} onChange={set('viewers')} />
      </div>
      <div className="grid-4">
        <div className="span-all">
          <Field
            id="p-yt"
            label="YouTube: link do vídeo da live ou ID do canal"
            placeholder="https://www.youtube.com/watch?v=..."
            value={form.youtubeUrl}
            onChange={set('youtubeUrl')}
           
          />
        </div>
        <Field id="p-vou" label="Valor do voucher (R$)" inputMode="decimal" value={form.voucher} onChange={set('voucher')} />
        <Field id="p-until" label="Válido para fechar até" type="date" value={form.validUntil} onChange={set('validUntil')} />
        <Field id="p-wa" label="WhatsApp da loja (DDD+número)" type="tel" placeholder="(48) 99999-9999" value={form.whatsapp} onChange={set('whatsapp')} />
        <Field
          id="p-hold"
          label="Reserva do Pix (minutos)"
          inputMode="numeric"
          value={form.holdMinutes}
          onChange={set('holdMinutes')}
         
          hint="Tempo que a moto fica segurada esperando o Pix"
        />
      </div>
      <details className="details">
        <summary>Depoimentos de clientes ({testimonials.length})</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {testimonials.map((t, i) => (
            <div key={i} className="grid-4" style={{ gridTemplateColumns: '1fr 1fr 2fr 44px' }}>
              <input className="input input--sm" aria-label="Nome" value={t.name} onChange={(e) => setTestimonials((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input input--sm" aria-label="Quando comprou" value={t.when} onChange={(e) => setTestimonials((l) => l.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)))} />
              <input className="input input--sm" aria-label="Depoimento" value={t.text} onChange={(e) => setTestimonials((l) => l.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <button type="button" className="icon-btn" aria-label="Remover depoimento" onClick={() => setTestimonials((l) => l.filter((_, j) => j !== i))}>
                <IconTrash />
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn--soft btn--sm" onClick={() => setTestimonials((l) => [...l, { name: '', when: '', text: '' }])}>
              Adicionar depoimento
            </button>
          </div>
          <div className="small">Use apenas depoimentos reais, com autorização do cliente. Sem depoimentos, o bloco não aparece na loja.</div>
        </div>
      </details>
      {msg && <div className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</div>}
      <div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() =>
            void save(
              {
                startsAt: fromLocalInput(form.startsAt),
                viewers: Number(form.viewers.replace(/\D/g, '')) || 0,
                youtubeUrl: form.youtubeUrl || null,
                voucherCents: Math.round(Number(form.voucher.replace(/\./g, '').replace(',', '.')) * 100),
                validUntil: form.validUntil || null,
                whatsapp: form.whatsapp || null,
                holdMinutes: Number(form.holdMinutes) || 30,
                testimonials: testimonials.filter((t) => t.name.trim() && t.text.trim()),
              },
              'Transmissão salva. A loja já mostra as mudanças.',
            )
          }
        >
          Salvar transmissão
        </button>
      </div>
    </section>
  );
}
