import { useEffect, useState } from 'react';
import { formatBrPhone, formatTime, formatDate, type AdminOrderRow, type OrderStatus } from '@lle/shared';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

const STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  pending_payment: { label: 'Aguardando pagamento', tone: 'badge--yellow' },
  paid: { label: 'Pago', tone: 'badge--green' },
  completed: { label: 'Fechado', tone: 'badge--blue' },
  expired: { label: 'Expirado', tone: '' },
  failed: { label: 'Recusado', tone: 'badge--red' },
  refund_pending: { label: 'Devolvendo', tone: 'badge--yellow' },
  refunded: { label: 'Devolvido', tone: '' },
};

function statusLabel(o: AdminOrderRow): string {
  if (o.status === 'paid') return o.paymentMethod === 'card' ? 'Cartão confirmado' : 'Pix confirmado';
  return STATUS[o.status].label;
}

const FILTERS: [string, string][] = [
  ['', 'Todas'],
  ['paid', 'Pagas'],
  ['pending_payment', 'Aguardando'],
  ['expired', 'Expiradas'],
  ['failed', 'Recusadas'],
  ['refunded', 'Devolvidas'],
];

/**
 * "Reservas em tempo real": só consulta. O fechamento da compra e a devolução do voucher acontecem fora do
 * site (gerente da loja e planilha do relatório), por isso a lista não tem botões de ação.
 */
export function OrdersSection({ data }: SectionProps) {
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminOrderRow[]>(data.orders);

  useEffect(() => {
    if (!filter && !q) {
      setRows(data.orders);
      return;
    }
    const t = window.setTimeout(() => {
      adminApi.orders({ status: filter, q }).then(setRows).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(t);
  }, [filter, q, data.orders]);

  return (
    <section className="panel" id="reservas">
      <div className="panel__head">
        <h2>Reservas em tempo real</h2>
        <span>
          {rows.length} {rows.length === 1 ? 'registro' : 'registros'}
        </span>
      </div>
      <div className="filters">
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
        <input className="input input--sm" style={{ maxWidth: 280 }} placeholder="Buscar voucher, nome, CPF ou WhatsApp" aria-label="Buscar reservas" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Voucher</th>
              <th>Cliente</th>
              <th>Moto</th>
              <th>Loja</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  {formatTime(o.paidAt ?? o.createdAt)}
                  <small>{formatDate(o.paidAt ?? o.createdAt)}</small>
                </td>
                <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {o.code}
                  {o.paymentId && <small style={{ fontWeight: 400 }}>MP {o.paymentId}</small>}
                </td>
                <td>
                  {o.customerName} · {formatBrPhone(o.customerWhatsapp)}
                  <small>{o.customerCpfMasked}</small>
                </td>
                <td>
                  {o.modelName}
                  {o.preferredColor && <small>Cor: {o.preferredColor}</small>}
                </td>
                <td>{o.storeName}</td>
                <td>
                  <span className={`badge ${STATUS[o.status].tone}`}>{statusLabel(o)}</span>
                  {o.statusReason && <small title={o.statusReason}>{o.statusReason.slice(0, 60)}</small>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="small">
                  Nenhuma reserva {filter || q ? 'com esse filtro' : 'ainda'}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="small">
        As reservas feitas na loja aparecem aqui na hora. Esta lista é só para consulta: o fechamento da compra é com o gerente da loja e a devolução do
        voucher (crédito não aprovado) é feita pela Geração por Pix. Use a planilha do relatório para cruzar cliente, moto, comprovante e código.
      </div>
    </section>
  );
}
