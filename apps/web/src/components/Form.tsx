import type { InputHTMLAttributes, ReactNode } from 'react';
import { IconMinus, IconPlus } from './Icons';

/** Campo com rótulo e mensagem de erro acessível (usado na loja e no painel). */
export function Field({
  id,
  label,
  error,
  hint,
  ...input
}: { id: string; label: ReactNode; error?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} {...input} />
      {error && (
        <span id={`${id}-err`} className="field__error">
          {error}
        </span>
      )}
      {hint && !error && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="switch__track">
        <span className="switch__thumb" />
      </span>
      {label}
    </button>
  );
}

export function Stepper({
  value,
  onDec,
  onInc,
  disabled,
  label,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Diminuir" onClick={onDec} disabled={disabled || value <= 0}>
        <IconMinus />
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="Aumentar" onClick={onInc} disabled={disabled}>
        <IconPlus />
      </button>
    </div>
  );
}
