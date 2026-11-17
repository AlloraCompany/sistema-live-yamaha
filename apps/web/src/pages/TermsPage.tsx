import { formatBRL } from '@lle/shared';
import { StoreLayout } from '../components/Layout';
import { useLive } from '../lib/live';

/** Termo do voucher (texto-base para revisão jurídica; valores vêm da configuração da live). */
export function TermsPage() {
  const { snapshot } = useLive();
  // O valor vem sempre do painel (Transmissão); enquanto carrega, a frase sai sem valor.
  const voucher = snapshot ? ` de ${formatBRL(snapshot.live.voucherCents)}` : '';
  const hold = snapshot?.live.holdMinutes ?? 15;
  const items = [
    `O voucher${voucher} garante o preço de live da moto escolhida e reserva uma unidade em nome do comprador.`,
    `Enquanto o Pix não é pago, a unidade fica segurada por ${hold} minutos. Sem pagamento nesse prazo, a reserva é cancelada automaticamente e a unidade volta a ficar disponível.`,
    'A reserva só é confirmada após a aprovação do pagamento pelo Mercado Pago.',
    'O valor do voucher é abatido da entrada no fechamento da compra. O prazo para o fechamento é combinado com a loja, pelo WhatsApp.',
    'Se o crédito não for aprovado, o valor do voucher é devolvido integralmente pela Geração Yamaha, via Pix.',
    'Os brindes coletivos liberados pelo termômetro da live valem para todos os compradores da live, inclusive quem comprou antes de a meta ser batida.',
    'A data da retirada na loja escolhida é combinada com a loja após a aprovação do crédito.',
    'Os dados pessoais informados são usados apenas para a reserva, a análise de crédito e o contato da loja sobre esta compra, inclusive quando o pagamento não é concluído (LGPD).',
  ];
  return (
    <StoreLayout>
      <div className="card" style={{ marginTop: 8 }}>
        <h1 className="display" style={{ fontSize: 36 }}>
          Termo do <span className="hl">voucher</span>
        </h1>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </div>
    </StoreLayout>
  );
}
