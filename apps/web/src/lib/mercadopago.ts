/**
 * Card Payment Brick do Mercado Pago: os dados do cartão são digitados em campos do próprio MP
 * e viram um token. O número do cartão nunca passa pelo nosso servidor (escopo PCI reduzido).
 */

export interface CardFormData {
  token: string;
  issuer_id?: string | number | null;
  payment_method_id: string;
  transaction_amount: number;
  installments: number;
  payer: { email?: string; identification?: { type?: string; number?: string } };
}

interface BrickController {
  unmount: () => void;
}

interface MercadoPagoInstance {
  bricks: () => {
    create: (type: 'cardPayment', containerId: string, settings: Record<string, unknown>) => Promise<BrickController>;
  };
}

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, opts: { locale: string }) => MercadoPagoInstance;
  }
}

let sdk: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://sdk.mercadopago.com/js/v2';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      sdk = null;
      reject(new Error('Não foi possível carregar o Mercado Pago.'));
    };
    document.head.appendChild(s);
  });
  return sdk;
}

let configPromise: Promise<{ mpPublicKey: string | null }> | null = null;
export function publicConfig() {
  configPromise ??= fetch('/api/config').then((r) => r.json());
  return configPromise;
}

export async function mountCardBrick(opts: {
  containerId: string;
  amountCents: number;
  payerEmail: string;
  onSubmit: (data: CardFormData) => Promise<void>;
  onReady?: () => void;
  onError?: (message: string) => void;
}): Promise<BrickController> {
  const { mpPublicKey } = await publicConfig();
  if (!mpPublicKey) throw new Error('Pagamento com cartão indisponível neste ambiente.');
  await loadSdk();
  const mp = new window.MercadoPago!(mpPublicKey, { locale: 'pt-BR' });
  return mp.bricks().create('cardPayment', opts.containerId, {
    initialization: { amount: opts.amountCents / 100, payer: { email: opts.payerEmail } },
    customization: {
      // Voucher à vista: o parcelamento do valor da moto é feito no fechamento com o consultor.
      paymentMethods: { maxInstallments: 1, minInstallments: 1 },
      visual: { style: { theme: 'default', customVariables: { baseColor: '#1F62EA', borderRadiusMedium: '10px' } } },
    },
    callbacks: {
      onReady: () => opts.onReady?.(),
      onSubmit: (data: CardFormData) => opts.onSubmit(data),
      onError: (e: { message?: string }) => opts.onError?.(e?.message ?? 'Erro no formulário do cartão.'),
    },
  });
}
