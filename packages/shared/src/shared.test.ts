import { describe, expect, it } from 'vitest';
import {
  formatBRL,
  formatCpf,
  isValidCpf,
  maskCpf,
  normalizeBrPhone,
  nextGoalSentence,
  thermometerProgress,
} from './index.js';

const goals = [
  { id: 3, threshold: 50, prize: 'Capacete Yamaha', description: '' },
  { id: 1, threshold: 10, prize: 'Tanque cheio', description: '' },
  { id: 2, threshold: 20, prize: 'Emplacamento grátis', description: '' },
];

describe('formatBRL', () => {
  it('formata sem centavos quando o valor é inteiro, como no wireframe', () => {
    expect(formatBRL(2_299_000)).toBe('R$ 22.990');
    expect(formatBRL(100_000)).toBe('R$ 1.000');
  });
  it('mostra centavos quando existem', () => {
    expect(formatBRL(51_950)).toBe('R$ 519,50');
  });
});

describe('CPF', () => {
  it('aceita CPFs válidos com e sem máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });
  it('rejeita dígitos verificadores errados e sequências repetidas', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
  it('formata e mascara', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(maskCpf('52998224725')).toBe('***.982.247-**');
  });
});

describe('normalizeBrPhone', () => {
  it('normaliza celular com e sem DDI', () => {
    expect(normalizeBrPhone('(48) 99999-9999')).toBe('5548999999999');
    expect(normalizeBrPhone('+55 48 99999-9999')).toBe('5548999999999');
  });
  it('rejeita números inválidos', () => {
    expect(normalizeBrPhone('99999')).toBeNull();
    expect(normalizeBrPhone('(48) 89999-9999')).toBeNull();
  });
});

describe('thermometerProgress', () => {
  it('reproduz o wireframe: 7 vendas → 23,3% da barra e próxima meta Tanque cheio', () => {
    const p = thermometerProgress(7, goals);
    expect(p.fill).toBeCloseTo(0.2333, 3);
    expect(p.next?.prize).toBe('Tanque cheio');
    expect(p.goals.map((g) => [g.threshold, g.state, g.remaining])).toEqual([
      [10, 'next', 3],
      [20, 'upcoming', 13],
      [50, 'upcoming', 43],
    ]);
    expect(nextGoalSentence(p)).toBe('faltam 3 para tanque cheio');
  });
  it('8 vendas → 26,7% (tela de reserva confirmada)', () => {
    expect(thermometerProgress(8, goals).fill).toBeCloseTo(0.2667, 3);
  });
  it('marca metas batidas e enche o tubo ao passar da última', () => {
    const p = thermometerProgress(25, goals);
    expect(p.goals.map((g) => g.state)).toEqual(['achieved', 'achieved', 'next']);
    expect(p.fill).toBeCloseTo((2 + 5 / 30) / 3, 5);
    expect(thermometerProgress(60, goals).fill).toBe(1);
    expect(thermometerProgress(60, goals).next).toBeNull();
  });
  it('funciona sem metas', () => {
    expect(thermometerProgress(3, []).fill).toBe(0);
  });
});
