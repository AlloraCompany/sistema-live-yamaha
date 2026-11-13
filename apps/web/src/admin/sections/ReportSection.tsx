import { useState } from 'react';
import { IconDownload } from '../../components/Icons';
import type { SectionProps } from '../AdminApp';

/**
 * "Relatório da live" para os gerentes: planilha (Resumo, Vendas, Devolvidos, Quase compraram, Por moto)
 * e um PDF com os comprovantes, um por página. O código do voucher liga a planilha ao comprovante.
 */
export function ReportSection({ data }: SectionProps) {
  const [store, setStore] = useState('');
  const query = store ? `?store=${store}` : '';
  return (
    <section className="panel" id="relatorio">
      <div className="panel__head">
        <h2>Relatório da live</h2>
        <span>Para os gerentes das lojas · o código do voucher liga cada linha da planilha ao comprovante</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="r-store">Loja</label>
          <select id="r-store" className="input" value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">Todas as lojas</option>
            {data.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <a className="btn btn--primary" href={`/api/admin/reports/live.xlsx${query}`} download>
          <IconDownload size={18} />
          Planilha (Excel)
        </a>
        <a className="btn btn--soft" href={`/api/admin/reports/receipts.pdf${query}`} download>
          <IconDownload size={18} />
          Comprovantes (PDF)
        </a>
      </div>
      <div className="small">
        A planilha traz as vendas válidas, os vouchers devolvidos e quem quase comprou (Pix gerado e não pago, cartão recusado ou pagamento
        depois de esgotar), sem quem acabou comprando. O PDF tem um comprovante por página, na mesma ordem da aba "Vendas".
        {!store && ' A lista de espera vai só no relatório de todas as lojas.'}
      </div>
    </section>
  );
}
