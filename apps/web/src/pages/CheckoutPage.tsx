import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  formatBRL,
  formatCpf,
  isValidCpf,
  maskPhoneInput,
  normalizeBrPhone,
  type CreateOrderInput,
  type CreateOrderResult,
} from '@lle/shared';
import { BackLink, Steps, StoreLayout } from '../components/Layout';
import { CardBrick, MethodToggle, TermsCheck, VoucherSummary } from '../components/PaymentParts';
import { Field } from '../components/Form';
import { OfferStrip } from '../components/OfferStrip';
import { useLive, useThermometer } from '../lib/live';
import { api, ApiError, newClientToken, orderTokens } from '../lib/api';
import type { CardFormData } from '../lib/mercadopago';
import { NotFound } from './NotFound';

interface FormState {
  name: string;
  cpf: string;
  whatsapp: string;
  email: string;
  storeId: number;
}

const EMPTY: FormState = { name: '', cpf: '', whatsapp: '', email: '', storeId: 0 };
const DRAFT_KEY = 'lle:checkout';

function validate(f: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().split(/\s+/).length < 2) e['customer.name'] = 'Informe nome e sobrenome.';
  if (!isValidCpf(f.cpf)) e['customer.cpf'] = 'CPF inválido.';
  if (!normalizeBrPhone(f.whatsapp)) e['customer.whatsapp'] = 'WhatsApp inválido. Use DDD + número.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e['customer.email'] = 'E-mail inválido.';
  if (!f.storeId) e.storeId = 'Escolha a loja de retirada.';
  return e;
}

export function CheckoutPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { snapshot } = useLive();
  const thermo = useThermometer();
  const [form, setForm] = useState<FormState>(() => {
    try {
      return { ...EMPTY, ...(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<FormState>) };
    } catch {
      return EMPTY;
    }
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<'pix' | 'card'>('pix');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  // Token do pedido: o mesmo enquanto esta tentativa estiver em andamento (reenvio seguro).
  const tokenKey = `lle:token:${slug}`;
  const [clientToken, setClientToken] = useState(() => sessionStorage.getItem(tokenKey) ?? newClientToken());

  useEffect(() => sessionStorage.setItem(tokenKey, clientToken), [tokenKey, clientToken]);
  useEffect(() => {
    const { cpf: _c, ...rest } = form; // CPF não fica salvo nem na sessão
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
  }, [form]);
  useEffect(() => {
    if (!form.storeId && snapshot?.stores[0]) setForm((f) => ({ ...f, storeId: snapshot.stores[0]!.id }));
  }, [snapshot, form.storeId]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    let v = e.target.value;
    if (k === 'cpf') v = formatCpf(v);
    if (k === 'whatsapp') v = maskPhoneInput(v);
    setForm((f) => ({ ...f, [k]: k === 'storeId' ? Number(v) : v }));
    setErrors((er) => {
      const { [k === 'storeId' ? 'storeId' : `customer.${k}`]: _, ...rest } = er;
      return rest;
    });
  };

  const m = useMemo(() => snapshot?.models.find((x) => x.slug === slug), [snapshot, slug]);
  if (!snapshot) return <StoreLayout>{<div className="skeleton" style={{ height: 600, marginTop: 24 }} />}</StoreLayout>;
  if (!m) return <NotFound />;
  const voucherCents = snapshot.live.voucherCents;

  function payload(payment: CreateOrderInput['payment']): CreateOrderInput {
    return {
      modelSlug: m!.slug,
      storeId: form.storeId,
      customer: { name: form.name, cpf: form.cpf, whatsapp: form.whatsapp, email: form.email.trim() },
      acceptTerms: true,
      clientToken,
      payment,
    };
  }

  function check(): boolean {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) {
      setFatal('Confira os campos destacados em "Seus dados".');
      return false;
    }
    if (!terms) {
      setFatal('É preciso aceitar o termo do voucher.');
      return false;
    }
    setFatal(null);
    return true;
  }

  async function submit(payment: CreateOrderInput['payment']): Promise<CreateOrderResult | null> {
    setBusy(true);
    try {
      const res = await api<CreateOrderResult>('/api/orders', { method: 'POST', json: payload(payment) });
      orderTokens.set(res.order.code, clientToken);
      return res;
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFatal(err.message);
        if (['SOLD_OUT', 'ALL_ON_HOLD', 'NOT_RELEASED', 'LIVE_NOT_OPEN', 'OFFER_INACTIVE'].includes(err.code)) setClientToken(newClientToken());
      } else setFatal('Algo deu errado. Tente de novo.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function finish(res: CreateOrderResult) {
    sessionStorage.removeItem(tokenKey);
    navigate(`/pedido/${res.order.code}`, { state: { token: clientToken } });
  }

  async function payPix() {
    if (!check()) return;
    const res = await submit({ method: 'pix' });
    if (res) finish(res);
  }

  async function payCard(d: CardFormData) {
    if (!check()) throw new Error('form');
    const res = await submit({
      method: 'card',
      token: d.token,
      paymentMethodId: d.payment_method_id,
      issuerId: d.issuer_id != null ? String(d.issuer_id) : null,
      installments: 1,
      attemptKey: newClientToken().slice(0, 32),
      payer: { email: d.payer.email, identificationType: d.payer.identification?.type, identificationNumber: d.payer.identification?.number },
    });
    if (!res) throw new Error('order');
    if (res.order.status === 'failed') {
      // Cartão recusado: o pedido foi encerrado e a moto liberada; próxima tentativa é um pedido novo.
      setClientToken(newClientToken());
      setFatal(res.paymentError?.message ?? 'Pagamento não aprovado.');
      throw new Error('rejected');
    }
    finish(res);
  }

  const err = (k: string) => errors[k];
  const canBuy = m.purchasable;

  return (
    <StoreLayout>
      <Steps current={3} />
      <BackLink to={`/motos/${m.slug}`}>Voltar para a moto</BackLink>
      {/* Protótipo da testeira (só em desenvolvimento; não vai para o site publicado). */}
      {import.meta.env.DEV && <OfferStrip />}
      <div className="two-col">
        <div className="card">
          <h2>Seus dados</h2>
          <VoucherSummary modelName={m.name} priceCents={m.priceLiveCents ?? 0} voucherCents={voucherCents} validUntil={snapshot.live.validUntil} thermo={thermo} />
          <Field id="d-nome" label="Nome completo" placeholder="Como está no seu documento" autoComplete="name" value={form.name} onChange={set('name')} error={err('customer.name')} />
          <div className="grid-2">
            <Field id="d-cpf" label="CPF" placeholder="000.000.000-00" inputMode="numeric" value={form.cpf} onChange={set('cpf')} error={err('customer.cpf')} />
            <Field id="d-zap" label="WhatsApp" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(48) 99999-9999" value={form.whatsapp} onChange={set('whatsapp')} error={err('customer.whatsapp')} />
          </div>
          <Field id="d-email" label="E-mail (para o comprovante)" type="email" autoComplete="email" placeholder="voce@email.com" value={form.email} onChange={set('email')} error={err('customer.email')} />
          <div className="field">
            <label htmlFor="d-loja">Loja para retirada</label>
            <select id="d-loja" className="input" value={form.storeId} onChange={set('storeId')}>
              {snapshot.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="card">
          <h2>Pagamento</h2>
          {!canBuy && <div className="alert alert--warn">Esta moto não está disponível para compra agora.</div>}
          <MethodToggle value={method} onChange={setMethod} disabled={busy} />
          <TermsCheck checked={terms} onChange={setTerms} validUntil={snapshot.live.validUntil} />
          {fatal && (
            <div className="alert alert--error" role="alert">
              {fatal}
            </div>
          )}
          {method === 'pix' ? (
            <>
              <button type="button" className="btn btn--primary btn--block btn--lg" disabled={busy || !canBuy} onClick={payPix}>
                {busy ? <span className="spinner" /> : null}
                Gerar Pix de {formatBRL(voucherCents)}
              </button>
              <div className="small">
                Ao gerar o Pix, a unidade fica segurada para você por {snapshot.live.holdMinutes} minutos. Com o Pix confirmado, ela fica reservada no seu
                nome e você vai direto para o comprovante.
              </div>
            </>
          ) : canBuy ? (
            <>
              <CardBrick amountCents={voucherCents} payerEmail={form.email} onSubmit={payCard} />
              <div className="small">Pagamento à vista no cartão, processado pelo Mercado Pago. Os dados do cartão não passam pelos nossos servidores.</div>
            </>
          ) : null}
        </div>
      </div>
    </StoreLayout>
  );
}
