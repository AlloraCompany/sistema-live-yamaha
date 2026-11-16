import type {
  AdminFailedJob,
  AdminKpis,
  AdminLiveSettings,
  AdminModel,
  AdminOrderRow,
  AdminStore,
  Consultant,
  Goal,
} from '@lle/shared';
import { api } from '../lib/api';

export interface Dashboard {
  kpis: AdminKpis;
  settings: AdminLiveSettings;
  goals: Goal[];
  models: AdminModel[];
  orders: AdminOrderRow[];
  consultants: Consultant[];
  stores: AdminStore[];
  failedJobs: AdminFailedJob[];
}

const base = '/api/admin';

export const adminApi = {
  me: () => api<{ ok: true }>(`${base}/me`),
  login: (password: string) => api<{ ok: true }>(`${base}/login`, { method: 'POST', json: { password } }),
  logout: () => api(`${base}/logout`, { method: 'POST', json: {} }),
  dashboard: () => api<Dashboard>(`${base}/dashboard`),
  patchLive: (patch: Partial<AdminLiveSettings>) => api<AdminLiveSettings>(`${base}/live`, { method: 'PATCH', json: patch }),
  offlineSale: (delta: 1 | -1) => api<{ offlineSales: number }>(`${base}/live/offline-sales`, { method: 'POST', json: { delta } }),
  saveGoals: (goals: Omit<Goal, 'id'>[]) => api<Goal[]>(`${base}/goals`, { method: 'PUT', json: { goals } }),
  release: (id: number, released: boolean) => api(`${base}/models/${id}/release`, { method: 'POST', json: { released } }),
  releaseAll: (released: boolean) => api(`${base}/models/release-all`, { method: 'POST', json: { released } }),
  createModel: (m: Record<string, unknown>) => api<{ id: number }>(`${base}/models`, { method: 'POST', json: m }),
  patchModel: (id: number, m: Record<string, unknown>) => api(`${base}/models/${id}`, { method: 'PATCH', json: m }),
  addUnits: (id: number, body: { quantity?: number }) => api(`${base}/models/${id}/units`, { method: 'POST', json: body }),
  removeUnit: (id: number) => api(`${base}/models/${id}/units/remove`, { method: 'POST', json: {} }),
  uploadPhoto: (modelId: number, file: File, color: string | null) =>
    api<{ id: string }>(`${base}/models/${modelId}/photos${color ? `?color=${encodeURIComponent(color)}` : ''}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type },
    }),
  deletePhoto: (id: string) => api(`${base}/photos/${id}`, { method: 'DELETE' }),
  orders: (q: { status?: string; q?: string }) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return api<AdminOrderRow[]>(`${base}/orders?${p}`);
  },
  completeOrder: (id: string) => api(`${base}/orders/${id}/complete`, { method: 'POST', json: {} }),
  refundOrder: (id: string, reason: string) => api(`${base}/orders/${id}/refund`, { method: 'POST', json: { reason } }),
  waitlist: () => api<{ id: number; name: string; whatsapp: string; created_at: string; model_name: string }[]>(`${base}/waitlist`),
  patchStore: (id: number, s: { name: string; whatsapp: string | null }) =>
    api<AdminStore[]>(`${base}/stores/${id}`, { method: 'PATCH', json: s }),
  createConsultant: (c: Omit<Consultant, 'id'>) => api<Consultant[]>(`${base}/consultants`, { method: 'POST', json: c }),
  patchConsultant: (id: number, c: Omit<Consultant, 'id'>) => api<Consultant[]>(`${base}/consultants/${id}`, { method: 'PATCH', json: c }),
  retryJob: (id: number) => api(`${base}/jobs/${id}/retry`, { method: 'POST', json: {} }),
};
