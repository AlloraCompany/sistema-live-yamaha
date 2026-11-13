import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatBRL, formatIsoDay, type ThermometerProgress } from '@lle/shared';
import { mountCardBrick, type CardFormData } from '../lib/mercadopago';

/** Linhas de resumo do voucher (cartão "Seus dados"). */
export function VoucherSummary({
  modelName,
  priceCents,
  voucherCents,
  validUntil,
  thermo,
}: {
  modelName: string;
  priceCents: number;
  voucherCents: number;
  validUntil: string | null;
  thermo: ThermometerProgress | null;
}) {
  const achieved = thermo?.goals.filter((g) => g.state === 'achieved') ?? [];
  const gifts = achieved.length
    ? achieved.map((g) => g.prize).join(', ')
    : thermo?.next
      ? `Nenhum liberado ainda · ${thermo.next.prize.toLowerCase()} com ${thermo.next.threshold} motos`
      : null;
  return (
    <div className="summary">
      <div className="row">
        <span>Moto</span>
        <span>{modelName}</span>
      </div>
      <div className="row">
        <span>Preço garantido</span>
        <span>{formatBRL(priceCents)}</span>
      </div>
      <div className="row">
        <span>Valor do voucher</span>
        <span>{formatBRL(voucherCents)}</span>
      </div>
      <div className="row">
        <span>Fechar até</span>
        <span>{validUntil ? formatIsoDay(validUntil) : 'Combinado com o consultor'}</span>
      </div>
      {gifts && (
        <div className="row">
          <span>Brindes da live</span>
          <span>{gifts}</span>
        </div>
      )}
    </div>
  );
}

export function MethodToggle({ value, onChange, disabled }: { value: 'pix' | 'card'; onChange: (v: 'pix' | 'card') => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Forma de pagamento" className="seg">
      <button type="button" aria-pressed={value === 'pix'} disabled={disabled} onClick={() => onChange('pix')}>
        Pix
      </button>
      <button type="button" aria-pressed={value === 'card'} disabled={disabled} onClick={() => onChange('card')}>
        Cartão de crédito
      </button>
    </div>
  );
}

export function TermsCheck({ checked, onChange, validUntil }: { checked: boolean; onChange: (v: boolean) => void; validUntil: string | null }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Li e aceito o{' '}
        <Link to="/termo-do-voucher" target="_blank" style={{ fontWeight: 700 }}>
          termo do voucher
        </Link>
        : valor abatido da entrada, devolução integral se o crédito não for aprovado
        {validUntil ? (
          <>
            , válido até <strong>{formatIsoDay(validUntil)}</strong>
          </>
        ) : null}
        .
      </span>
    </label>
  );
}

/**
 * Formulário de cartão do Mercado Pago (Card Payment Brick). `onSubmit` recebe o token do cartão;
 * rejeitar a promise mantém o formulário preenchido para o cliente corrigir.
 */
export function CardBrick({
  amountCents,
  payerEmail,
  onSubmit,
}: {
  amountCents: number;
  payerEmail: string;
  onSubmit: (data: CardFormData) => Promise<void>;
}) {
  const id = `card-brick-${useId().replace(/:/g, '')}`;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controller: { unmount: () => void } | null = null;
    let cancelled = false;
    mountCardBrick({
      containerId: id,
      amountCents,
      payerEmail,
      onSubmit: (d) => submitRef.current(d),
      onReady: () => !cancelled && setStatus('ready'),
      onError: (m) => !cancelled && setError(m),
    })
      .then((c) => {
        if (cancelled) c.unmount();
        else controller = c;
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setStatus('error');
          setError(e.message);
        }
      });
    return () => {
      cancelled = true;
      controller?.unmount();
    };
    // O Brick é montado uma vez por valor; o e-mail é só sugestão inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, amountCents]);

  return (
    <div>
      {status === 'loading' && <div className="skeleton" style={{ height: 320 }} />}
      {status === 'error' && <div className="alert alert--error">{error ?? 'Pagamento com cartão indisponível. Use o Pix.'}</div>}
      <div id={id} />
      {status === 'ready' && error && <div className="alert alert--error">{error}</div>}
    </div>
  );
}
