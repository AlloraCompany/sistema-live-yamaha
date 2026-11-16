import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { formatBRL, formatBrPhone, formatDateTime, type CreateOrderResult, type OrderView } from '@lle/shared';
import { BackLink, Steps, StoreLayout } from '../components/Layout';
import { CardBrick, MethodToggle, VoucherSummary } from '../components/PaymentParts';
import { IconBigCheck, IconCheck, IconCopy, IconDownload, IconShare } from '../components/Icons';
import { useToast } from '../components/Toast';
import { useNow, useThermometer } from '../lib/live';
import { api, ApiError, download, newClientToken, orderTokens } from '../lib/api';
import { copyText, shareLive, whatsappLink } from '../lib/browser';
import type { CardFormData } from '../lib/mercadopago';

/** Pedido acompanhado em tempo real: Pix pendente → reserva confirmada (ou expirada/recusada). */
export function OrderPage() {
  const { code = '' } = useParams();
  const location = useLocation();
  const token = (location.state as { token?: string } | null)?.token ?? orderTokens.get(code);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skewMs, setSkewMs] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const o = await api<OrderView>(`/api/orders/${code}`, { orderToken: token });
      setSkewMs(new Date(o.serverTime).getTime() - Date.now());
      setOrder(o);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o pedido.');
    }
  }, [code, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Enquanto aguarda pagamento, consulta o pedido periodicamente.
  const waiting = order?.status === 'pending_payment';
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), order?.status === 'pending_payment' ? 3000 : 15000);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [waiting, load, order?.status]);

  if (!token) {
    return (
      <StoreLayout>
        <div className="empty" style={{ marginTop: 24 }}>
          <p style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Abra este pedido no aparelho em que ele foi feito</p>
          <p style={{ marginBottom: 16 }}>Por segurança, o voucher {code} só abre no navegador onde a compra começou. O comprovante também segue pelo WhatsApp.</p>
          <Link className="btn btn--primary" to="/">
            Voltar à live
          </Link>
        </div>
      </StoreLayout>
    );
  }
  if (!order) {
    return (
      <StoreLayout>
        {error ? <div className="alert alert--error" style={{ marginTop: 24 }}>{error}</div> : <div className="skeleton" style={{ height: 600, marginTop: 24 }} />}
      </StoreLayout>
    );
  }
  if (order.status === 'paid' || order.status === 'completed') return <Confirmed order={order} token={token} />;
  if (order.status === 'pending_payment') return <Pending order={order} token={token} skewMs={skewMs} onChange={setOrder} />;
  return <Closed order={order} />;
}

function Pending({ order, token, skewMs, onChange }: { order: OrderView; token: string; skewMs: number; onChange: (o: OrderView) => void }) {
  const now = useNow(1000) + skewMs;
  const toast = useToast();
  const [method, setMethod] = useState<'pix' | 'card'>(order.payment?.method === 'card' ? 'card' : 'pix');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const autoTried = useRef(false);

  const left = Math.max(0, new Date(order.holdExpiresAt).getTime() - now);
  const mm = String(Math.floor(left / 60000)).padStart(2, '0');
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  const pix = order.payment?.method === 'pix' && order.payment.pix && ['pending', 'in_process'].includes(order.payment.status) ? order.payment.pix : null;

  async function pay(payment: { method: 'pix' } | Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<CreateOrderResult>(`/api/orders/${order.code}/payments`, { method: 'POST', json: payment, orderToken: token });
      onChange(res.order);
      if (res.paymentError) setMessage(res.paymentError.message);
      return res;
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Não foi possível falar com o pagamento. Tente de novo.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Pedido criado mas o Pix não saiu (instabilidade do MP): tenta gerar de novo uma vez automaticamente.
  useEffect(() => {
    if (method === 'pix' && !pix && !autoTried.current && left > 0) {
      autoTried.current = true;
      void pay({ method: 'pix' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function payCard(d: CardFormData) {
    const res = await pay({
      method: 'card',
      token: d.token,
      paymentMethodId: d.payment_method_id,
      issuerId: d.issuer_id != null ? String(d.issuer_id) : null,
      installments: 1,
      attemptKey: newClientToken().slice(0, 32),
      payer: { email: d.payer.email, identificationType: d.payer.identification?.type, identificationNumber: d.payer.identification?.number },
    });
    if (!res || res.order.status === 'pending_payment') throw new Error('not-paid');
  }

  return (
    <StoreLayout>
      <Steps current={3} />
      <BackLink to={`/motos/${order.model.slug}`}>Voltar para a moto</BackLink>
      <div className="two-col">
        <div className="card">
          <h2>Seus dados</h2>
          <VoucherSummary modelName={order.model.name} priceCents={order.priceLiveCents} voucherCents={order.voucherCents} />
          <div className="summary">
            <div className="row">
              <span>Nome</span>
              <span>{order.customer.name}</span>
            </div>
            <div className="row">
              <span>CPF</span>
              <span>{order.customer.cpfMasked}</span>
            </div>
            <div className="row">
              <span>WhatsApp</span>
              <span>{formatBrPhone(order.customer.whatsapp)}</span>
            </div>
            <div className="row">
              <span>Loja de preferência</span>
              <span>{order.store.name}</span>
            </div>
            {order.preferredColor && (
              <div className="row">
                <span>Cor de preferência</span>
                <span>{order.preferredColor}</span>
              </div>
            )}
          </div>
          <div className="small">Voucher {order.code}</div>
        </div>
        <div className="card">
          <h2>Pagamento</h2>
          <MethodToggle value={method} onChange={setMethod} disabled={busy} />
          {message && (
            <div className="alert alert--error" role="alert">
              {message}
            </div>
          )}
          {method === 'pix' ? (
            pix ? (
              <>
                <div className="pix">
                  <div className="pix__qr" role="img" aria-label="QR Code Pix">
                    <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="" />
                  </div>
                  <div className="pix__body">
                    <div className="pix__title">Escaneie ou copie o código Pix</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }} aria-live="off">
                      Unidade segurada para você por <span className="pix__timer">{mm}:{ss}</span>. Depois disso ela volta para os outros clientes.
                    </div>
                    <div className="pix__code">{pix.qrCode}</div>
                    <div>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        style={{ minHeight: 44 }}
                        onClick={async () => {
                          await copyText(pix.qrCode);
                          toast('Código Pix copiado. Cole no app do seu banco.');
                        }}
                      >
                        <IconCopy />
                        Copiar código
                      </button>
                    </div>
                  </div>
                </div>
                <div className="waiting" aria-live="polite">
                  <span className="spinner" /> Aguardando o pagamento… esta tela atualiza sozinha.
                </div>
              </>
            ) : (
              <button type="button" className="btn btn--primary btn--block btn--lg" disabled={busy || left === 0} onClick={() => void pay({ method: 'pix' })}>
                {busy ? <span className="spinner" /> : null}
                Gerar Pix de {formatBRL(order.voucherCents)}
              </button>
            )
          ) : (
            <CardBrick amountCents={order.voucherCents} payerEmail={order.customer.email} onSubmit={payCard} />
          )}
          {left === 0 && <div className="alert alert--warn">O tempo da reserva acabou. Se você já pagou, aguarde: a confirmação chega em instantes.</div>}
          <div className="small">Com o pagamento confirmado, a unidade fica reservada no seu nome e você vai direto para o comprovante.</div>
        </div>
      </div>
    </StoreLayout>
  );
}

function Confirmed({ order, token }: { order: OrderView; token: string }) {
  const thermo = useThermometer();
  const toast = useToast();
  // Único telefone divulgado: o do gerente da loja de preferência. Loja sem número fica sem o botão.
  const storePhone = order.storeWhatsapp;
  const waMessage =
    `Acabei de garantir o meu voucher ${order.code} da Live Limpa Estoque para a ${order.model.name}` +
    `${order.preferredColor ? `, cor de preferência ${order.preferredColor}` : ''}. Quero fechar a compra!`;

  async function get(path: string, name: string) {
    try {
      await download(`/api/orders/${order.code}/${path}`, name, token);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Não foi possível baixar o arquivo.');
    }
  }

  return (
    <StoreLayout thermometer={false}>
      <Steps current={4} />
      <div className="done-hero">
        <span className="done-hero__icon">
          <IconBigCheck />
        </span>
        <h1 className="display">
          Reserva <span className="hl">confirmada</span>
        </h1>
        <p>Seu voucher está garantido e a unidade foi reservada no seu nome.</p>
      </div>
      <div className="two-col" style={{ gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div className="ticket">
            <div className="ticket__head">
              <span>VOUCHER · GERAÇÃO YAMAHA</span>
              <span className="ticket__code">{order.code}</span>
            </div>
            <div className="ticket__rows">
              {[
                ['Cliente', order.customer.name],
                ['Moto', order.model.name],
                ...(order.preferredColor ? [['Cor de preferência', order.preferredColor]] : []),
                ['Preço garantido', formatBRL(order.priceLiveCents)],
                ['Pago', `${formatBRL(order.voucherCents)} via ${order.paidWith === 'card' ? 'cartão' : 'Pix'}`],
                ['Loja de preferência', order.store.name],
                ['Data', order.paidAt ? formatDateTime(order.paidAt) : '-'],
              ].map(([k, v]) => (
                <div key={k} className="row">
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            Valor abatido da entrada no fechamento. Devolução integral se o crédito não for aprovado.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--outline btn--md" onClick={() => void get('receipt.pdf', `voucher-${order.code}.pdf`)}>
              <IconDownload />
              Baixar comprovante
            </button>
            <button
              type="button"
              className="btn btn--soft btn--md"
              onClick={async () => {
                await copyText(order.code);
                toast('Código do voucher copiado.');
              }}
            >
              <IconCopy size={18} />
              Copiar código
            </button>
          </div>
          <div className="alert alert--info">
            O código <strong>{order.code}</strong> é único e identifica a sua reserva na loja. A nota fiscal da moto é emitida pela loja no
            faturamento.
          </div>
        </div>

        <div className="card">
          <h2>O que acontece agora</h2>
          {[
            storePhone ? (
              <>Chame o gerente da loja {order.store.name} no WhatsApp pelo botão abaixo e mande o comprovante ao lado.</>
            ) : (
              <>A equipe da loja {order.store.name} chama você no WhatsApp. Tenha o comprovante ao lado em mãos.</>
            ),
            <>Envie RG ou CNH e comprovante de renda pelo WhatsApp para a análise de crédito.</>,
            <>
              Com o crédito aprovado, o gerente combina com você o fechamento da compra e a retirada na loja <strong>{order.store.name}</strong>.
            </>,
          ].map((t, i) => (
            <div key={i} className="next-step">
              <span className="next-step__n">{i + 1}</span>
              <span className="next-step__t">{t}</span>
            </div>
          ))}
          {thermo && thermo.goals.length > 0 && (
            <div className="gifts">
              <div className="gifts__title">Seus brindes desta live</div>
              {thermo.goals.map((g) => (
                <div key={g.id} className="gift">
                  <span className={`gift__mark ${g.state === 'achieved' ? 'gift__mark--done' : ''}`}>{g.state === 'achieved' && <IconCheck size={12} />}</span>
                  <span>
                    <strong>{g.prize}</strong> ·{' '}
                    {g.state === 'achieved'
                      ? 'liberado! Você ganha.'
                      : `faltam ${g.remaining} ${g.remaining === 1 ? 'moto' : 'motos'}. Se a live chegar a ${g.threshold}, você também ganha.`}
                  </span>
                </div>
              ))}
              <div className="small">Quanto mais gente comprar, mais você ganha. Chame amigos para a live.</div>
            </div>
          )}
          {storePhone && (
            <>
              <a className="btn btn--whatsapp btn--block btn--lg" style={{ fontSize: 14 }} href={whatsappLink(storePhone, waMessage)} target="_blank" rel="noopener noreferrer">
                <img src="/brand/whatsapp.png" alt="" className="wa-icon" />
                Falar com o gerente da loja {order.store.name}
              </a>
              <div className="small center">
                Se o link não abrir, mande mensagem para <strong style={{ color: 'var(--ink)' }}>{formatBrPhone(storePhone)}</strong>.
              </div>
            </>
          )}
          <button
            type="button"
            className="btn btn--outline btn--block"
            onClick={async () => {
              if ((await shareLive()) === 'copied') toast('Link da live copiado!');
            }}
          >
            <IconShare />
            Chamar amigos para a live
          </button>
          <Link className="btn btn--soft btn--block" to="/">
            Voltar à live
          </Link>
          <div className="small center">Guarde o comprovante: ele também fica disponível nesta página, neste aparelho.</div>
        </div>
      </div>
    </StoreLayout>
  );
}

function Closed({ order }: { order: OrderView }) {
  const titles: Record<string, string> = {
    expired: 'O tempo da reserva acabou',
    failed: 'Pagamento não aprovado',
    refund_pending: 'Devolução do voucher em andamento',
    refunded: 'Voucher devolvido',
  };
  const texts: Record<string, string> = {
    expired: 'O pagamento não foi confirmado dentro do prazo e a unidade voltou para os outros clientes. Se a moto ainda tiver unidades, é só tentar de novo.',
    failed: 'O pagamento foi recusado e nenhuma cobrança foi feita. Você pode tentar de novo com Pix ou outro cartão.',
    refund_pending: 'O valor do voucher está sendo devolvido integralmente para a mesma forma de pagamento.',
    refunded: 'O valor do voucher foi devolvido integralmente para a mesma forma de pagamento.',
  };
  return (
    <StoreLayout>
      <Steps current={3} />
      <div className="card" style={{ marginTop: 24, maxWidth: 640 }}>
        <h2>{titles[order.status] ?? 'Pedido encerrado'}</h2>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text)' }}>{texts[order.status]}</p>
        {order.statusReason && <div className="small">{order.statusReason}</div>}
        <div className="small">
          Voucher {order.code} · {order.model.name}
        </div>
        {(order.status === 'expired' || order.status === 'failed') && (
          <Link className="btn btn--primary btn--block" to={`/motos/${order.model.slug}/voucher`}>
            Tentar de novo
          </Link>
        )}
        <Link className="btn btn--soft btn--block" to="/">
          Voltar à live
        </Link>
      </div>
    </StoreLayout>
  );
}
