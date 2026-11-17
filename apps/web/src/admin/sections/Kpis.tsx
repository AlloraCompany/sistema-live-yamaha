import { formatBRL, formatInt, type AdminKpis } from '@lle/shared';

export function Kpis({ kpis }: { kpis: AdminKpis }) {
  const items: [string, string, boolean?][] = [
    ['Motos liberadas', `${kpis.modelsReleased} de ${kpis.modelsTotal}`],
    ['Vendidas na live', String(kpis.soldInLive), true],
    [kpis.nextGoal ? `Faltam para ${kpis.nextGoal.prize}` : 'Metas', kpis.nextGoal ? String(kpis.nextGoal.remaining) : 'Batidas'],
    ['Reservas pagas no site', String(kpis.soldOnSite)],
    ['Sinal arrecadado', formatBRL(kpis.depositCents)],
    ['Pedidos "Eu quero"', String(kpis.waitlist)],
    ['Estoque restante', String(kpis.stockAvailable)],
    ['Pix em andamento', String(kpis.pixInProgress)],
    ['Assistindo agora', formatInt(kpis.viewers)],
  ];
  return (
    <div className="kpis">
      {items.map(([label, value, hl]) => (
        <div key={label} className={`kpi ${hl ? 'kpi--hl' : ''}`}>
          <span>{label}</span>
          <span title={value}>{value}</span>
        </div>
      ))}
    </div>
  );
}
