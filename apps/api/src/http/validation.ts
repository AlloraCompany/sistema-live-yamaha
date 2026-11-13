import type { ZodType, ZodTypeDef } from 'zod';
import { Errors } from '../lib/errors.js';

/** Valida a entrada e devolve 422 com a primeira mensagem legível + a lista de campos. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const res = schema.safeParse(data);
  if (res.success) return res.data;
  const issues = res.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  throw Errors.validation(issues[0]?.message ?? 'Dados inválidos.', issues);
}
