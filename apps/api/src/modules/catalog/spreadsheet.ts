import { slugify } from '../../lib/text.js';
import { buildXlsx, readXlsxSheet } from '../reports/xlsx.js';

/**
 * Planilha das motos: modelo para preencher (Excel ou Google Planilhas) e leitura para importar
 * o catálogo de uma vez. Fotos continuam sendo enviadas pelo painel (por cor).
 */

export const CATALOG_SHEET = 'Motos';

const COLUMNS = [
  { header: 'Modelo', width: 26, example: 'Fazer FZ25 ABS', help: 'Obrigatório. Nome como aparece na loja.' },
  { header: 'Categoria / ano', width: 18, example: 'Naked · 2026', help: 'Opcional. Aparece acima do nome.' },
  { header: 'Preço de tabela', width: 16, example: '24.490', help: 'Obrigatório. Em reais (24490 ou 24.490,00).' },
  { header: 'Preço na live', width: 16, example: '22.990', help: 'Obrigatório. Preço garantido para quem compra o voucher.' },
  { header: 'Entrada', width: 12, example: '3.000', help: 'Opcional. Valor da entrada no financiamento.' },
  { header: 'Parcela', width: 12, example: '519', help: 'Opcional. Valor de cada parcela.' },
  { header: 'Nº de parcelas', width: 14, example: '48', help: 'Opcional (padrão 48).' },
  { header: 'Observação da taxa', width: 28, example: 'taxa a partir de 0,99% a.m.', help: 'Opcional. Texto pequeno abaixo da parcela.' },
  {
    header: 'Estoque por cor',
    width: 28,
    example: 'Preta: 3; Cinza: 2; Azul: 1',
    help: 'Obrigatório. Quantas motos físicas existem de cada cor, separadas por ponto e vírgula. Sem cor: só o número (ex.: 4).',
  },
  {
    header: 'Ficha técnica',
    width: 44,
    example: 'Motor: 249 cc; Potência: 20,5 cv; Freios: ABS nas duas rodas; Tanque: 14 litros',
    help: 'Opcional. Itens "Nome: valor" separados por ponto e vírgula.',
  },
  { header: 'Descrição', width: 50, example: 'A naked mais vendida da loja: ágil na cidade e confortável na estrada.', help: 'Opcional. Até 1000 caracteres.' },
] as const;

/** Modelo da planilha: aba "Motos" (só cabeçalho) + aba "Como preencher" com exemplo e regras. */
export function buildCatalogTemplate(): Buffer {
  return buildXlsx([
    { name: CATALOG_SHEET, columns: COLUMNS.map((c) => ({ header: c.header, width: c.width })), rows: [] },
    {
      name: 'Como preencher',
      columns: [
        { header: 'Coluna', width: 22 },
        { header: 'Exemplo', width: 44 },
        { header: 'Como preencher', width: 90 },
      ],
      rows: [
        ...COLUMNS.map((c) => [c.header, c.example, c.help]),
        [],
        ['Uma linha por modelo', '', 'Preencha a aba "Motos", uma moto por linha, sem mudar a ordem das colunas.'],
        ['Fotos', '', 'Envie as fotos pelo painel (bloco "Motos, preços e fotos"), escolhendo a cor de cada foto.'],
        ['Liberação', '', 'Toda moto importada entra BLOQUEADA. A liberação é feita no painel, na hora do anúncio.'],
      ],
    },
  ]);
}

export interface CatalogRow {
  /** Linha na planilha (para mensagens de erro). */
  line: number;
  name: string;
  slug: string;
  categoryLabel: string;
  priceTableCents: number;
  priceLiveCents: number;
  downPaymentCents: number;
  installmentCents: number;
  installments: number;
  rateNote: string;
  /** Cor ('' = sem cor) → quantidade de motos físicas. */
  stock: { color: string; quantity: number }[];
  specs: { label: string; value: string }[];
  description: string;
}

/** "22.990", "22990", "R$ 22.990,00", "22990.5" (número gravado pelo Excel) → centavos. */
export function parseMoney(raw: string): number | null {
  const s = raw.replace(/R\$|\s/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
    return Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 100);
  return Number.NaN;
}

function parseStock(raw: string): { color: string; quantity: number }[] | string {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return [{ color: '', quantity: Number(s) }];
  const out: { color: string; quantity: number }[] = [];
  for (const part of s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*[:=-]?\s*(\d+)$/.exec(part);
    if (!m) return `não entendi "${part}" (use "Cor: quantidade")`;
    const color = m[1]!.replace(/[:=-]\s*$/, '').trim();
    if (color.length > 30) return `nome de cor muito longo: "${color}"`;
    const existing = out.find((x) => x.color.toLowerCase() === color.toLowerCase());
    if (existing) existing.quantity += Number(m[2]);
    else out.push({ color, quantity: Number(m[2]) });
  }
  return out;
}

function parseSpecs(raw: string): { label: string; value: string }[] | string {
  const out: { label: string; value: string }[] = [];
  for (const part of raw.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i <= 0 || i === part.length - 1) return `item da ficha técnica sem "Nome: valor": "${part}"`;
    out.push({ label: part.slice(0, i).trim().slice(0, 40), value: part.slice(i + 1).trim().slice(0, 80) });
  }
  return out.slice(0, 20);
}

/** Lê a planilha preenchida. Devolve as motos válidas e, se houver, a lista de problemas por linha. */
export function parseCatalog(buf: Buffer): { rows: CatalogRow[]; errors: string[] } {
  const sheet = readXlsxSheet(buf, CATALOG_SHEET);
  const header = (sheet[0] ?? []).map((h) => h.toLowerCase());
  const expected = COLUMNS.map((c) => c.header.toLowerCase());
  if (expected.some((h, i) => header[i] !== h)) {
    return { rows: [], errors: [`O cabeçalho da aba "${CATALOG_SHEET}" não confere com o modelo (colunas: ${COLUMNS.map((c) => c.header).join(', ')}).`] };
  }
  const rows: CatalogRow[] = [];
  const errors: string[] = [];
  const slugs = new Map<string, number>();
  sheet.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (k: number) => (cells[k] ?? '').trim();
    if (cells.every((c) => !c?.trim())) return; // linha em branco
    const problems: string[] = [];
    const name = get(0);
    if (name.length < 2 || name.length > 80) problems.push('informe o modelo (2 a 80 caracteres)');
    const slug = slugify(name);
    if (slug && slugs.has(slug)) problems.push(`modelo repetido (já está na linha ${slugs.get(slug)})`);
    const money = (k: number, label: string, required: boolean) => {
      const v = parseMoney(get(k));
      if (v === null) {
        if (required) problems.push(`informe o ${label}`);
        return 0;
      }
      if (Number.isNaN(v) || v < 0) problems.push(`${label} inválido: "${get(k)}"`);
      return Number.isNaN(v) ? 0 : v;
    };
    const priceTableCents = money(2, 'preço de tabela', true);
    const priceLiveCents = money(3, 'preço na live', true);
    const downPaymentCents = money(4, 'valor da entrada', false);
    const installmentCents = money(5, 'valor da parcela', false);
    const installments = get(6) ? Number(get(6)) : 48;
    if (!Number.isInteger(installments) || installments < 1 || installments > 120) problems.push(`nº de parcelas inválido: "${get(6)}"`);
    if (priceLiveCents > 0 && priceTableCents > 0 && priceLiveCents > priceTableCents) problems.push('preço na live maior que o de tabela');
    const stock = get(8) ? parseStock(get(8)) : 'informe o estoque por cor';
    if (typeof stock === 'string') problems.push(stock);
    const specs = parseSpecs(get(9));
    if (typeof specs === 'string') problems.push(specs);
    const description = get(10);
    if (description.length > 1000) problems.push('descrição com mais de 1000 caracteres');

    if (problems.length) {
      errors.push(`Linha ${line}${name ? ` (${name})` : ''}: ${problems.join('; ')}.`);
      return;
    }
    slugs.set(slug, line);
    rows.push({
      line,
      name,
      slug,
      categoryLabel: get(1).slice(0, 60),
      priceTableCents,
      priceLiveCents,
      downPaymentCents,
      installmentCents,
      installments,
      rateNote: get(7).slice(0, 120),
      stock: stock as CatalogRow['stock'],
      specs: specs as CatalogRow['specs'],
      description,
    });
  });
  if (rows.length === 0 && errors.length === 0) errors.push(`A aba "${CATALOG_SHEET}" está vazia.`);
  return { rows, errors };
}
