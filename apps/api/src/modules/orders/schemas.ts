import { z } from 'zod';
import { isValidCpf, normalizeBrPhone, onlyDigits } from '@lle/shared';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

const text = (min: number, max: number, msg: string) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min, msg).max(max, msg));

export const customerSchema = z.object({
  name: text(5, 80, 'Informe o nome completo, como está no documento.').refine(
    (s) => s.split(' ').length >= 2,
    'Informe nome e sobrenome.',
  ),
  cpf: z
    .string()
    .transform(onlyDigits)
    .refine(isValidCpf, 'CPF inválido.'),
  whatsapp: z
    .string()
    .transform((s, ctx) => {
      const n = normalizeBrPhone(s);
      if (!n) {
        ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido. Use DDD + número.' });
        return z.NEVER;
      }
      return n;
    }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(120)
    .email('E-mail inválido.'),
});

export const cardPaymentSchema = z.object({
  method: z.literal('card'),
  token: z.string().min(8).max(200),
  paymentMethodId: z.string().min(2).max(40),
  issuerId: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null || v === '' ? null : String(v))),
  installments: z.coerce.number().int().min(1).max(1),
  attemptKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  payer: z
    .object({
      email: z.string().email().optional(),
      identificationType: z.string().max(10).optional(),
      identificationNumber: z.string().max(20).optional(),
    })
    .optional(),
});

export const pixPaymentSchema = z.object({ method: z.literal('pix') });

export const paymentInputSchema = z.discriminatedUnion('method', [pixPaymentSchema, cardPaymentSchema]);

export const createOrderSchema = z.object({
  modelSlug: z.string().min(1).max(80),
  storeId: z.coerce.number().int().positive(),
  color: z
    .string()
    .max(30)
    .nullish()
    .transform((s) => (s == null || s.trim() === '' ? null : s.trim())),
  customer: customerSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar o termo do voucher.' }) }),
  clientToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, 'Token do pedido inválido.'),
  payment: paymentInputSchema,
});

export type CreateOrderParsed = z.infer<typeof createOrderSchema>;
export type PaymentInputParsed = z.infer<typeof paymentInputSchema>;
