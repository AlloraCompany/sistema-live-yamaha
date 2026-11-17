import { useState } from 'react';
import { formatDateTime, type LiveStatus } from '@lle/shared';
import { Field } from '../../components/Form';
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function init() {
    return {
      viewers: String(s.viewers),
      youtubeUrl: s.youtubeUrl ?? '',
      voucher: String(s.voucherCents / 100),
      offersUntil: toLocalInput(s.offersUntil),
    };
  }
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
                  if (
                    value === 'encerrada' &&
                    !confirm(
                      s.offersUntil
                        ? `Encerrar a live? A transmissão sai do ar na hora e a loja mostra o agradecimento. As compras continuam abertas até ${formatDateTime(s.offersUntil)}.`
                        : 'Encerrar a live? A transmissão sai do ar e as compras no site fecham na hora.',
                    )
                  )
                    return;
                  void save({ status: value }, `Status alterado para "${label}".`);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="field__hint">
            Sem link do YouTube a live fica "Em breve". Ao salvar o link, ela passa sozinha para "Ao vivo". "Encerrada" é só por clique.
          </span>
        </div>
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
        <div className="span-all">
          <Field
            id="p-offers"
            label="Depois de encerrada, condições válidas no site até"
            type="datetime-local"
            value={form.offersUntil}
            onChange={set('offersUntil')}
            hint="A loja mostra o agradecimento com contador regressivo e continua vendendo até este horário. Vazio = as compras fecham ao encerrar."
          />
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</div>}
      <div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() =>
            void save(
              {
                viewers: Number(form.viewers.replace(/\D/g, '')) || 0,
                youtubeUrl: form.youtubeUrl || null,
                voucherCents: Math.round(Number(form.voucher.replace(/\./g, '').replace(',', '.')) * 100),
                // Sem prazo de fechamento no site: o gerente combina com o cliente pelo WhatsApp.
                validUntil: null,
                offersUntil: fromLocalInput(form.offersUntil),
                // A reserva do Pix é fixa em 15 minutos (migration 003): não é mais configurável aqui.
                // Sem depoimentos na loja (decisão de 16/11/2026): garante a lista vazia.
                testimonials: [],
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
