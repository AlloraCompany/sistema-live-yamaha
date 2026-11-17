/**
 * Apaga os dados do ensaio antes da live (pedidos, pagamentos, lista de espera, vendas de balcão),
 * devolve as unidades ao estoque, bloqueia as motos e volta a live para "Em breve".
 * Motos, fotos, preços, estoque, metas, consultores e configurações são mantidos.
 *
 *   npm run ensaio:limpar -w @lle/api                              → só mostra o que seria apagado
 *   npm run ensaio:limpar -w @lle/api -- --confirmar               → apaga
 *   npm run ensaio:limpar -w @lle/api -- --confirmar --apagar-pagos → apaga mesmo havendo pedidos pagos
 *                                                                     (use só para pagamentos de TESTE ou já devolvidos)
 *
 * Usa o DATABASE_URL do ambiente. Recusa rodar com a live "Ao vivo".
 */
import { createDb } from '../src/db/pool.js';
import { createLogger } from '../src/logger.js';
import { AppError } from '../src/lib/errors.js';
import { clearRehearsalData, rehearsalSummary } from '../src/modules/admin/rehearsal.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL.');
  process.exit(1);
}
const log = createLogger('warn');
const db = createDb({ connectionString: url, max: 2, ssl: process.env.DATABASE_SSL === 'true', log, appName: 'lle-ensaio' });

try {
  const s = await rehearsalSummary(db.pool);
  console.log(`Banco: ${new URL(url).host}${new URL(url).pathname}`);
  console.log(`Live: ${s.liveStatus} · pedidos: ${s.orders} (pagos sem devolução: ${s.paidNotRefunded}) · pagamentos: ${s.payments}`);
  console.log(`"Eu quero" e lista de espera: ${s.waitlist} · ajuste manual do termômetro: ${s.offlineSales} · motos liberadas: ${s.releasedModels} · unidades em uso: ${s.unitsInUse}`);
  if (!process.argv.includes('--confirmar')) {
    console.log('\nNada foi apagado. Para apagar, rode de novo com --confirmar.');
  } else {
    await clearRehearsalData(db, { allowPaid: process.argv.includes('--apagar-pagos') });
    console.log('\nDados do ensaio apagados. Motos bloqueadas, termômetro zerado e live "Em breve".');
  }
} catch (err) {
  console.error(err instanceof AppError ? `\nNão apagado: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await db.close();
}
