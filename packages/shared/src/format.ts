/** Formatação e validação de dados brasileiros usadas pela API e pela loja. */

const brlInteger = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const brlCents = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Valor em centavos → "R$ 22.990" (sem centavos quando o valor é inteiro, como no wireframe). */
export function formatBRL(cents: number): string {
  const value = cents / 100;
  return (cents % 100 === 0 ? brlInteger : brlCents).format(value);
}

/** Inteiro com separador de milhar: 1248 → "1.248". */
export function formatInt(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

/** Valida CPF pelos dígitos verificadores. Aceita com ou sem máscara. */
export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

/** CPF parcialmente oculto para telas e logs: ***.456.789-** */
export function maskCpf(value: string): string {
  const d = onlyDigits(value);
  if (d.length !== 11) return '***';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/**
 * Normaliza celular brasileiro para E.164 sem "+": 5548999999999.
 * Retorna null se não parecer um celular/fixo brasileiro válido.
 */
export function normalizeBrPhone(value: string): string | null {
  let d = onlyDigits(value);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (d.length === 11 && d[2] !== '9') return null;
  return `55${d}`;
}

export function formatBrPhone(e164: string): string {
  const d = onlyDigits(e164).replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return e164;
}

/** Máscara progressiva para o campo de WhatsApp. */
export function maskPhoneInput(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const longDayFmt = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Sao_Paulo',
});

/** "18/11/2026" */
export function formatDate(iso: string | Date): string {
  return dateFmt.format(new Date(iso));
}
/** "19:42" */
export function formatTime(iso: string | Date): string {
  return timeFmt.format(new Date(iso));
}
/** "18/11/2026 · 19:42" */
export function formatDateTime(iso: string | Date): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}
/** "18 de novembro, 19h" (19h30 quando há minutos). */
export function formatLiveStart(iso: string | Date): string {
  const d = new Date(iso);
  const [h, m] = formatTime(d).split(':');
  return `${longDayFmt.format(d)}, ${Number(h)}h${m === '00' ? '' : m}`;
}

/** Data ISO (YYYY-MM-DD, sem fuso) → "18/11/2026". */
export function formatIsoDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}
