import { useEffect, useState } from 'react';
import { formatBrPhone, maskPhoneInput, type AdminStore } from '@lle/shared';
import { ApiError } from '../../lib/api';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

type Row = { name: string; whatsapp: string };

const toRow = (s: AdminStore): Row => ({ name: s.name, whatsapp: s.whatsapp ? formatBrPhone(s.whatsapp) : '' });

/**
 * "Lojas": o cliente escolhe a loja de preferência no checkout e o botão do comprovante abre o WhatsApp
 * do gerente dela, já com a mensagem pronta (voucher, moto e cor de preferência). É o único telefone
 * divulgado ao cliente: não há WhatsApp geral nem de consultor.
 */
export function StoresSection({ data, onChange }: SectionProps) {
  const [rows, setRows] = useState<Record<number, Row>>(() => Object.fromEntries(data.stores.map((s) => [s.id, toRow(s)])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  // Lojas novas (ou a primeira carga) entram no formulário sem apagar o que está sendo digitado.
  useEffect(() => {
    setRows((r) => ({ ...Object.fromEntries(data.stores.map((s) => [s.id, toRow(s)])), ...r }));
  }, [data.stores]);

  const set = (id: number, k: keyof Row) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = k === 'whatsapp' ? maskPhoneInput(e.target.value) : e.target.value;
    setRows((r) => ({ ...r, [id]: { ...r[id]!, [k]: v } }));
  };

  async function save(s: AdminStore) {
    const row = rows[s.id]!;
    setBusy(s.id);
    setMsg(null);
    try {
      await adminApi.patchStore(s.id, { name: row.name.trim(), whatsapp: row.whatsapp.trim() || null });
      await onChange();
      setMsg({ ok: true, text: `Loja ${row.name.trim()} salva.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Falha ao salvar.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel" id="lojas">
      <div className="panel__head">
        <h2>Lojas</h2>
        <span>O cliente escolhe a loja de preferência no checkout; o botão do comprovante abre o WhatsApp do gerente dela</span>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Loja</th>
              <th>WhatsApp do gerente (DDD+número)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.stores.map((s) => {
              const row = rows[s.id] ?? toRow(s);
              const changed = row.name.trim() !== s.name || row.whatsapp !== (s.whatsapp ? formatBrPhone(s.whatsapp) : '');
              return (
                <tr key={s.id}>
                  <td>
                    <input className="input input--sm" aria-label={`Nome da loja ${s.name}`} value={row.name} onChange={set(s.id, 'name')} />
                  </td>
                  <td>
                    <input
                      className="input input--sm"
                      type="tel"
                      inputMode="tel"
                      placeholder="(48) 99999-9999"
                      aria-label={`WhatsApp do gerente da loja ${s.name}`}
                      value={row.whatsapp}
                      onChange={set(s.id, 'whatsapp')}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy === s.id || !changed || row.name.trim().length < 2} onClick={() => void save(s)}>
                      Salvar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="small">
        Este é o único telefone que o cliente recebe. Loja sem número cadastrado fica sem o botão do WhatsApp no comprovante. A mensagem já vai
        escrita: "Acabei de garantir o meu voucher … para a [moto], cor de preferência [cor]. Quero fechar a compra!".
      </div>
    </section>
  );
}
