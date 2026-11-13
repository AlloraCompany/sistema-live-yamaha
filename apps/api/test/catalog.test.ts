import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zip } from '../src/lib/zip.js';
import { readXlsxSheet } from '../src/modules/reports/xlsx.js';
import { buildCatalogTemplate, parseCatalog, parseMoney } from '../src/modules/catalog/spreadsheet.js';
import { applyCatalog } from '../src/modules/catalog/import.js';
import { clearRehearsalData } from '../src/modules/admin/rehearsal.js';
import { assertInvariants, createHarness, orderInput, seedLive, type Harness } from './support/harness.js';

const HEADER = [
  'Modelo', 'Categoria / ano', 'Preço de tabela', 'Preço na live', 'Entrada', 'Parcela', 'Nº de parcelas',
  'Observação da taxa', 'Estoque por cor', 'Ficha técnica', 'Descrição',
];

/** Planilha no formato que o Excel grava: textos em sharedStrings.xml, números como números. */
function excelLike(rows: (string | number)[][]): Buffer {
  const strings: string[] = [];
  const idx = (s: string) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const sheet = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) =>
          v === ''
            ? ''
            : typeof v === 'number'
              ? `<c r="${col(ci)}${ri + 1}" s="3"><v>${v}</v></c>`
              : `<c r="${col(ci)}${ri + 1}" t="s"><v>${idx(v)}</v></c>`,
        )
        .join('');
      return `<row r="${ri + 1}" spans="1:11">${cells}</row>`;
    })
    .join('');
  return zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Instruções" sheetId="2" r:id="rId9"/><sheet name="Motos" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Type="ws" Target="worksheets/sheet9.xml"/></Relationships>',
    },
    { name: 'xl/worksheets/sheet9.xml', data: '<worksheet><sheetData/></worksheet>' },
    { name: 'xl/sharedStrings.xml', data: `<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><cols><col min="1" max="1"/></cols><sheetData>${sheet}</sheetData></worksheet>` },
  ]);
}

describe('planilha das motos', () => {
  it('entende preços como o Excel grava e como as pessoas digitam', () => {
    expect(parseMoney('22990')).toBe(2_299_000);
    expect(parseMoney('22990.5')).toBe(2_299_050);
    expect(parseMoney('22.990')).toBe(2_299_000);
    expect(parseMoney('R$ 22.990,00')).toBe(2_299_000);
    expect(parseMoney('519,90')).toBe(51_990);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('vinte mil')).toBeNaN();
  });

  it('o modelo gerado tem a aba "Motos" com o cabeçalho certo e a leitura recusa planilha vazia', () => {
    const template = buildCatalogTemplate();
    expect(readXlsxSheet(template, 'Motos')[0]).toEqual(HEADER);
    expect(parseCatalog(template).errors).toEqual(['A aba "Motos" está vazia.']);
  });

  it('lê a planilha do Excel (textos compartilhados, números, aba fora de ordem) e aponta erros por linha', () => {
    const file = excelLike([
      HEADER,
      ['NMAX 160 ABS', 'Scooter · 2026', 22990, 21490, 2500, 489, 48, 'taxa a partir de 0,99% a.m.', 'Preta: 2; Azul: 1', 'Motor: 155 cc; Freios: ABS', 'Scooter & cidade'],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['Lander 250', '', 'R$ 26.900,00', '24.990', '', '', '', '', '3', '', ''],
      ['XTZ Sem Preço', '', '', 19990, '', '', '', '', 'Vermelha 1', '', ''],
      ['Fazer Errada', '', 20000, 21000, '', '', 200, '', 'Preta: x', 'Motor sem dois pontos', ''],
    ]);
    const { rows, errors } = parseCatalog(file);
    expect(rows.map((r) => r.name)).toEqual(['NMAX 160 ABS', 'Lander 250']);
    expect(rows[0]).toMatchObject({
      slug: 'nmax-160-abs',
      priceTableCents: 2_299_000,
      priceLiveCents: 2_149_000,
      downPaymentCents: 250_000,
      installmentCents: 48_900,
      installments: 48,
      stock: [
        { color: 'Preta', quantity: 2 },
        { color: 'Azul', quantity: 1 },
      ],
      specs: [
        { label: 'Motor', value: '155 cc' },
        { label: 'Freios', value: 'ABS' },
      ],
      description: 'Scooter & cidade',
    });
    expect(rows[1]).toMatchObject({ priceTableCents: 2_690_000, priceLiveCents: 2_499_000, stock: [{ color: '', quantity: 3 }] });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^Linha 5 \(XTZ Sem Preço\): informe o preço de tabela/);
    expect(errors[1]).toMatch(/^Linha 6 \(Fazer Errada\):.*parcelas inválido.*preço na live maior.*Preta: x.*sem "Nome: valor"/);
  });
});

describe('importação e limpeza do ensaio (banco)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await seedLive(h.ctx, { units: 4 });
  });
  afterAll(async () => {
    await assertInvariants(h.ctx);
    await h.close();
  });

  const units = async (slug: string) =>
    (
      await h.ctx.db.query<{ color: string | null; status: string; c: number }>(
        `SELECT u.color, u.status, count(*)::int AS c FROM units u JOIN models m ON m.id = u.model_id
          WHERE m.slug = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
        [slug],
      )
    ).rows;

  it('simulação não grava; importar cria as motos bloqueadas, com as unidades por cor; repetir não muda nada', async () => {
    const { rows } = parseCatalog(excelLike([HEADER, ['NMAX 160 ABS', '', 22990, 21490, '', '', '', '', 'Preta: 2; Azul: 1', '', '']]));
    const dry = await applyCatalog(h.ctx.db, rows, { deactivateOthers: false, dryRun: true });
    expect(dry.changes).toEqual([{ name: 'NMAX 160 ABS', action: 'criada', unitsAdded: 3, unitsRemoved: 0, unitsKept: 0 }]);
    expect((await h.ctx.db.query(`SELECT 1 FROM models WHERE slug = 'nmax-160-abs'`)).rowCount).toBe(0);

    await applyCatalog(h.ctx.db, rows, { deactivateOthers: false, dryRun: false });
    const { rows: m } = await h.ctx.db.query(`SELECT released_at, offer_active, price_live_cents FROM models WHERE slug = 'nmax-160-abs'`);
    expect(m[0]).toMatchObject({ released_at: null, offer_active: true, price_live_cents: 2_149_000 });
    expect(await units('nmax-160-abs')).toEqual([
      { color: 'Azul', status: 'available', c: 1 },
      { color: 'Preta', status: 'available', c: 2 },
    ]);
    const again = await applyCatalog(h.ctx.db, rows, { deactivateOthers: false, dryRun: false });
    expect(again.changes[0]).toMatchObject({ action: 'atualizada', unitsAdded: 0, unitsRemoved: 0 });
  });

  it('ao diminuir o estoque, só retira unidade livre; a que está em pagamento fica e é avisada', async () => {
    const pending = await h.createOrder(orderInput(1)); // segura 1 FZ25
    expect(pending.body.order.status).toBe('pending_payment');
    const { rows } = parseCatalog(excelLike([HEADER, ['Fazer FZ25 ABS', '', 24490, 22990, '', '', '', '', '0', '', '']]));
    const result = await applyCatalog(h.ctx.db, rows, { deactivateOthers: true, dryRun: false });
    expect(result.changes[0]).toMatchObject({ unitsRemoved: 3, unitsKept: 1 });
    expect(result.deactivated).toEqual(['NMAX 160 ABS']);
    expect(await units('fazer-fz25-abs')).toEqual([
      { color: null, status: 'held', c: 1 },
      { color: null, status: 'removed', c: 3 },
    ]);
  });

  it('limpeza do ensaio: recusa com a live no ar e com pagamento não devolvido; depois zera tudo e mantém o catálogo', async () => {
    await expect(clearRehearsalData(h.ctx.db, { allowPaid: true })).rejects.toThrow(/Ao vivo/);
    await h.ctx.db.query(`UPDATE live_settings SET status = 'encerrada', offline_sales = 3`);
    await h.ctx.db.query(`UPDATE models SET released_at = now(), offer_active = true`);
    await h.ctx.db.query(`UPDATE live_settings SET status = 'ao_vivo'`);
    // Pagamento de teste aprovado (moto liberada e live no ar), depois a live é encerrada para limpar.
    await h.ctx.db.query(`INSERT INTO units (model_id) SELECT id FROM models WHERE slug = 'nmax-160-abs'`);
    const card = await h.createOrder(
      orderInput(2, {
        modelSlug: 'nmax-160-abs',
        payment: { method: 'card', token: 'APRO-ensaio', paymentMethodId: 'master', installments: 1, attemptKey: 'attempt-ensaio-000000001' },
      }),
    );
    expect(card.body.order.status).toBe('paid');
    await h.ctx.db.query(`UPDATE live_settings SET status = 'encerrada'`);
    await expect(clearRehearsalData(h.ctx.db, { allowPaid: false })).rejects.toThrow(/apagar-pagos/);

    const before = await clearRehearsalData(h.ctx.db, { allowPaid: true });
    expect(before).toMatchObject({ orders: 2, paidNotRefunded: 1, offlineSales: 3 });
    const { rows } = await h.ctx.db.query(
      `SELECT (SELECT count(*)::int FROM orders) AS orders, (SELECT count(*)::int FROM payments) AS payments,
              (SELECT count(*)::int FROM units WHERE status IN ('held', 'sold')) AS used,
              (SELECT count(*)::int FROM models WHERE released_at IS NOT NULL) AS released,
              (SELECT count(*)::int FROM models) AS models,
              (SELECT status FROM live_settings) AS status`,
    );
    expect(rows[0]).toEqual({ orders: 0, payments: 0, used: 0, released: 0, models: 2, status: 'em_breve' });
    expect((await h.snapshot()).sales.sold).toBe(0);
  });
});
