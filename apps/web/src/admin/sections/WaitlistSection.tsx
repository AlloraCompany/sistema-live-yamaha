import { useEffect, useState } from 'react';
import { formatDate, formatTime } from '@lle/shared';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

type Row = { model_id: number; model_name: string; count: number; updated_at: string };

/**
 * "Eu quero!": na moto esgotada, o cliente toca um botão pedindo que ela volte na live (sem nome nem
 * telefone). Aqui o operador vê a procura por moto, para o apresentador decidir se abre mais unidades.
 */
export function WaitlistSection({ data }: SectionProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const total = data.kpis.waitlist;

  // O painel recarrega sozinho (a cada venda e a cada 30 segundos); a lista é buscada quando o total muda.
  useEffect(() => {
    adminApi.wants().then(setRows).catch(() => undefined);
  }, [total]);

  const top = rows[0]?.count ?? 0;

  return (
    <section className="panel" id="espera">
      <div className="panel__head">
        <h2>Pedidos "Eu quero"</h2>
        <span>
          {total} {total === 1 ? 'pedido' : 'pedidos'}
        </span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Moto</th>
              <th>Pedidos</th>
              <th>Último pedido</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model_id}>
                <td style={{ fontWeight: 700 }}>
                  {r.model_name}
                </td>
                <td>
                  <span className={`badge ${r.count === top ? 'badge--yellow' : ''}`}>{r.count}</span>
                </td>
                <td>
                  {formatTime(r.updated_at)}
                  <small>{formatDate(r.updated_at)}</small>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="small">
                  Nenhum pedido ainda. O botão "Eu quero!" aparece na loja quando a moto esgota.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="small">
        Cada toque no botão "Eu quero! Traz de volta na live" de uma moto esgotada soma aqui. Para a moto voltar à loja, aumente as unidades dela
        no bloco Motos (+).
      </div>
    </section>
  );
}
