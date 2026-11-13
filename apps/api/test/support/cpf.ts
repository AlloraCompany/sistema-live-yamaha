/** CPFs sintéticos válidos (dígitos verificadores corretos) para testes. */
export function cpf(n: number): string {
  const base = String(100_000_000 + (n % 800_000_000)).slice(-9).split('').map(Number);
  const dv = (digits: number[]) => {
    const len = digits.length;
    const sum = digits.reduce((s, d, i) => s + d * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}
