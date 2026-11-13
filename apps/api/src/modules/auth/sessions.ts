import type { Db } from '../../db/pool.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

export const SESSION_COOKIE = 'lle_session';

/**
 * Painel com senha única (ADMIN_PASSWORD). Sessões opacas: o cookie leva um token aleatório;
 * o banco guarda só o hash. Não há bloqueio por tentativas (um atacante bloquearia a dona do
 * painel no meio da live); a força bruta é contida pelo limite de tentativas por IP na rota
 * de login, pelo custo do scrypt e pelo tamanho mínimo da senha.
 */
export class AuthService {
  // Calculado uma vez por processo; a comparação usa scrypt + timingSafeEqual.
  private readonly passwordHash: Promise<string> | null;

  constructor(
    private readonly db: Db,
    private readonly password: string | undefined,
    private readonly ttlHours: number,
  ) {
    this.passwordHash = password ? hashPassword(password) : null;
  }

  async login(password: string, meta: { ip: string | null; userAgent: string | null }): Promise<string> {
    if (!this.passwordHash) {
      throw new AppError('ADMIN_DISABLED', 'Painel desativado: defina ADMIN_PASSWORD na configuração do servidor.', 503);
    }
    if (!(await verifyPassword(password, await this.passwordHash))) {
      throw new AppError('INVALID_LOGIN', 'Senha incorreta.', 401);
    }
    const token = randomToken(32);
    await this.db.query(
      `INSERT INTO sessions (token_hash, expires_at, ip, user_agent)
       VALUES ($1, now() + make_interval(hours => $2), $3, $4)`,
      [sha256(token), this.ttlHours, meta.ip, meta.userAgent?.slice(0, 300) ?? null],
    );
    return token;
  }

  async isValid(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const { rowCount } = await this.db.query(`SELECT 1 FROM sessions WHERE token_hash = $1 AND expires_at > now()`, [
      sha256(token),
    ]);
    return rowCount === 1;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  }

  /**
   * Na subida da API: se ADMIN_PASSWORD mudou desde a última vez, encerra todas as sessões
   * (quem entrou com a senha antiga precisa entrar de novo). Devolve true quando encerrou.
   */
  async revokeSessionsIfPasswordChanged(): Promise<boolean> {
    if (!this.password || !this.passwordHash) return false;
    const { rows } = await this.db.query<{ password_hash: string }>(`SELECT password_hash FROM admin_auth WHERE id = 1`);
    if (rows[0] && (await verifyPassword(this.password, rows[0].password_hash))) return false;
    const hash = await this.passwordHash;
    await this.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO admin_auth (id, password_hash) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
        [hash],
      );
      await tx.query(`DELETE FROM sessions`);
    });
    return true;
  }
}
