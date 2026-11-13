/**
 * Regras do termômetro de metas, compartilhadas entre API (KPIs do painel) e loja (desenho).
 *
 * O desenho do wireframe divide o tubo em segmentos iguais, um por meta: 7 vendas com metas
 * 10/20/50 ocupam 70% do primeiro segmento (23,3% da barra no mobile). O mesmo cálculo
 * alimenta a altura do tubo no desktop.
 */

export interface Goal {
  id: number;
  threshold: number;
  prize: string;
  description: string;
}

export type GoalState = 'achieved' | 'next' | 'upcoming';

export interface GoalProgress extends Goal {
  state: GoalState;
  remaining: number;
}

export interface ThermometerProgress {
  sold: number;
  goals: GoalProgress[]; // ordem crescente de meta
  next: GoalProgress | null;
  /** 0..1 — fração da barra/tubo preenchida (segmentos iguais por meta). */
  fill: number;
}

export function thermometerProgress(sold: number, rawGoals: Goal[]): ThermometerProgress {
  const goals = [...rawGoals].sort((a, b) => a.threshold - b.threshold);
  let nextFound = false;
  const progress: GoalProgress[] = goals.map((g) => {
    const remaining = Math.max(0, g.threshold - sold);
    let state: GoalState;
    if (remaining === 0) state = 'achieved';
    else if (!nextFound) {
      state = 'next';
      nextFound = true;
    } else state = 'upcoming';
    return { ...g, state, remaining };
  });
  return {
    sold,
    goals: progress,
    next: progress.find((g) => g.state === 'next') ?? null,
    fill: segmentFill(sold, goals.map((g) => g.threshold)),
  };
}

function segmentFill(sold: number, thresholds: number[]): number {
  const n = thresholds.length;
  if (n === 0) return 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = thresholds[i]!;
    if (sold < t) {
      const within = (sold - prev) / (t - prev);
      return (i + Math.max(0, within)) / n;
    }
    prev = t;
  }
  return 1;
}

/** Texto "faltam 3 para tanque cheio" usado na barra mobile e nos KPIs. */
export function nextGoalSentence(p: ThermometerProgress): string {
  if (!p.next) return p.goals.length ? 'todas as metas batidas' : '';
  return `faltam ${p.next.remaining} para ${p.next.prize.toLowerCase()}`;
}
