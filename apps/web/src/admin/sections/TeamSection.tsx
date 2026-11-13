import { useState } from 'react';
import { formatBrPhone, type Consultant } from '@lle/shared';
import { Field, Switch } from '../../components/Form';
import { ApiError } from '../../lib/api';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

/** Consultores: recebem os clientes da loja escolhida no checkout, em rodízio. */
export function TeamSection({ data, onChange }: SectionProps) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [c, setC] = useState({ name: '', whatsapp: '', storeId: '' });

  async function act(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      await onChange();
      setMsg({ ok: true, text: ok });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Falha ao salvar.' });
    }
  }

  const consultantBody = (x: Consultant) => ({ name: x.name, whatsapp: x.whatsapp, storeId: x.storeId, active: x.active });

  return (
    <section className="panel" id="consultores">
      <div className="panel__head">
        <h2>Consultores</h2>
        <span>Recebem os clientes da loja escolhida no checkout, em rodízio, e aparecem no comprovante com o WhatsApp</span>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Consultor</th>
              <th>WhatsApp</th>
              <th>Loja</th>
              <th>Ativo</th>
            </tr>
          </thead>
          <tbody>
            {data.consultants.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td>{x.whatsapp ? formatBrPhone(x.whatsapp) : '—'}</td>
                <td>{data.stores.find((s) => s.id === x.storeId)?.name ?? 'Todas'}</td>
                <td>
                  <Switch
                    checked={x.active}
                    label={x.active ? 'Ativo' : 'Inativo'}
                    onChange={(v) => void act(() => adminApi.patchConsultant(x.id, { ...consultantBody(x), active: v }), 'Consultor atualizado.')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-4">
        <Field id="c-name" label="Nome do consultor" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        <Field id="c-wa" label="WhatsApp" type="tel" value={c.whatsapp} onChange={(e) => setC({ ...c, whatsapp: e.target.value })} />
        <div className="field">
          <label htmlFor="c-store">Loja</label>
          <select id="c-store" className="input" value={c.storeId} onChange={(e) => setC({ ...c, storeId: e.target.value })}>
            <option value="">Todas as lojas</option>
            {data.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={c.name.trim().length < 2}
          onClick={() =>
            void act(async () => {
              await adminApi.createConsultant({ name: c.name, whatsapp: c.whatsapp || null, storeId: c.storeId ? Number(c.storeId) : null, active: true });
              setC({ name: '', whatsapp: '', storeId: '' });
            }, 'Consultor cadastrado.')
          }
        >
          Adicionar consultor
        </button>
      </div>
    </section>
  );
}
