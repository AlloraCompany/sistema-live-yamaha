import { useState } from 'react';
import { formatDateTime } from '@lle/shared';
import { ApiError } from '../../lib/api';
import { adminApi } from '../adminApi';
import type { SectionProps } from '../AdminApp';

const LABEL: Record<string, { title: string; hint: string }> = {
  'payment.refund': {
    title: 'Estorno no Mercado Pago',
    hint: 'Confira se a conta do Mercado Pago tem saldo para devolver o valor ao cliente.',
  },
  'payment.cancel': {
    title: 'Cancelamento de cobrança no Mercado Pago',
    hint: 'A cobrança ficou aberta no Mercado Pago; se o cliente pagar, o sistema estorna automaticamente.',
  },
};

/** Só aparece quando um estorno ou cancelamento no Mercado Pago esgotou as tentativas automáticas. */
export function FailedJobsSection({ data, onChange }: SectionProps) {
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (data.failedJobs.length === 0 && !msg) return null;

  async function retry(id: number) {
    setBusy(id);
    setMsg(null);
    try {
      await adminApi.retryJob(id);
      setMsg({ ok: true, text: 'Nova tentativa iniciada.' });
      await onChange();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Falha ao reenviar.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel" id="atencao" aria-labelledby="failed-jobs-title">
      <div className="panel__head">
        <h2 id="failed-jobs-title">Precisa de atenção</h2>
        <span>Tarefas automáticas que falharam depois de várias tentativas · resolva a causa e clique em "Tentar de novo"</span>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert--ok' : 'alert--error'}`}>{msg.text}</div>}
      {data.failedJobs.map((j) => {
        const label = LABEL[j.type] ?? { title: j.type, hint: '' };
        return (
          <div key={j.id} className="alert alert--error" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              <strong>
                {label.title}
                {j.orderCode ? ` · voucher ${j.orderCode}` : ''}
              </strong>
              <div className="small">
                Falhou em {formatDateTime(j.failedAt)}
                {j.lastError ? ` · ${j.lastError.slice(0, 160)}` : ''}
              </div>
              {label.hint && <div className="small">{label.hint}</div>}
            </div>
            <button type="button" className="btn btn--soft btn--sm" disabled={busy !== null} onClick={() => void retry(j.id)}>
              {busy === j.id && <span className="spinner" />}
              Tentar de novo
            </button>
          </div>
        );
      })}
    </section>
  );
}
