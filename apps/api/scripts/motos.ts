/**
 * Planilha das motos.
 *
 *   npm run motos:modelo -w @lle/api -- planilha-motos.xlsx
 *       gera o modelo para preencher (Excel ou Google Planilhas)
 *
 *   npm run motos:importar -w @lle/api -- planilha-motos.xlsx
 *       confere a planilha e mostra o que mudaria (não altera nada)
 *   npm run motos:importar -w @lle/api -- planilha-motos.xlsx --aplicar [--desativar-outras]
 *       grava no banco do DATABASE_URL; --desativar-outras tira da loja as motos que não estão na planilha
 *       (ex.: as de exemplo usadas no ensaio)
 *
 * As motos entram bloqueadas (a liberação é no painel) e as fotos são enviadas pelo painel.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatBRL } from '@lle/shared';
import { createDb } from '../src/db/pool.js';
import { createLogger } from '../src/logger.js';
import { applyCatalog } from '../src/modules/catalog/import.js';
import { buildCatalogTemplate, parseCatalog } from '../src/modules/catalog/spreadsheet.js';

const [command, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (f: string) => process.argv.includes(f);
// npm roda o script dentro de apps/api; caminhos relativos valem a partir de onde o comando foi digitado.
const resolve = (p: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), p);

if (command === 'modelo') {
  const out = resolve(file ?? 'planilha-motos.xlsx');
  await writeFile(out, buildCatalogTemplate());
  console.log(`Modelo gerado: ${out}`);
} else if (command === 'importar' && file) {
  const { rows, errors } = parseCatalog(await readFile(resolve(file)));
  if (errors.length) {
    console.error(`A planilha tem ${errors.length} problema(s); nada foi importado:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }
  for (const r of rows) {
    const units = r.stock.reduce((n, s) => n + s.quantity, 0);
    const colors = r.stock.map((s) => (s.color ? `${s.color} ${s.quantity}` : String(s.quantity))).join(', ');
    console.log(`  ${r.name}: ${formatBRL(r.priceLiveCents)} na live (tabela ${formatBRL(r.priceTableCents)}) · ${units} unidade(s): ${colors}`);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina DATABASE_URL para comparar com o banco.');
    process.exit(1);
  }
  const db = createDb({ connectionString: url, max: 2, ssl: process.env.DATABASE_SSL === 'true', log: createLogger('warn'), appName: 'lle-importacao' });
  try {
    const apply = flag('--aplicar');
    const result = await applyCatalog(db, rows, { deactivateOthers: flag('--desativar-outras'), dryRun: !apply });
    console.log(`\n${apply ? 'Importado em' : 'Simulação (nada gravado) em'} ${new URL(url).host}${new URL(url).pathname}:`);
    for (const c of result.changes) {
      const parts = [c.unitsAdded && `+${c.unitsAdded} unidade(s)`, c.unitsRemoved && `-${c.unitsRemoved} unidade(s)`].filter(Boolean);
      console.log(`  ${c.name}: ${c.action}${parts.length ? ` · ${parts.join(' · ')}` : ''}`);
      if (c.unitsKept) console.log(`    atenção: ${c.unitsKept} unidade(s) não saíram porque estão em pagamento ou vendidas`);
    }
    if (result.deactivated.length) console.log(`  Tiradas da loja: ${result.deactivated.join(', ')}`);
    if (!apply) console.log('\nPara gravar, rode de novo com --aplicar.');
  } finally {
    await db.close();
  }
} else {
  console.error('Uso: motos:modelo [arquivo.xlsx] | motos:importar arquivo.xlsx [--aplicar] [--desativar-outras]');
  process.exit(1);
}
