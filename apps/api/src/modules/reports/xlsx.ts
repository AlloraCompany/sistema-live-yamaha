import { unzip, zip } from '../../lib/zip.js';

/**
 * Planilhas .xlsx (Office Open XML) sem dependências: geração (abas, cabeçalho em negrito e congelado, R$)
 * e leitura simples de valores (para importar a planilha das motos preenchida no Excel ou Google Planilhas).
 */

export type CellType = 'text' | 'money' | 'int';

export interface Column {
  header: string;
  /** Largura em caracteres. */
  width: number;
  type?: CellType;
}

export interface Sheet {
  /** Nome da aba (até 31 caracteres, sem : \ / ? * [ ]). */
  name: string;
  columns: Column[];
  rows: (string | number | null | undefined)[][];
}

/** Índices em <cellXfs> (styles.xml abaixo). */
const STYLE = { header: 1, money: 2 } as const;

// Caracteres de controle não são aceitos em XML (nomes digitados no checkout podem trazer lixo).
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function esc(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cell(ref: string, value: string | number | null | undefined, type: CellType, style?: number): string {
  if (value === null || value === undefined || value === '') return '';
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const st = type === 'money' ? ` s="${STYLE.money}"` : s;
    return `<c r="${ref}"${st}><v>${value}</v></c>`;
  }
  // Fórmulas digitadas como texto (=, +, -, @) ficam como texto: inlineStr nunca é avaliado pelo Excel.
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
    .join('');
  const header = `<row r="1">${sheet.columns.map((c, i) => cell(`${colName(i)}1`, c.header, 'text', STYLE.header)).join('')}</row>`;
  const body = sheet.rows
    .map((row, r) => {
      const n = r + 2;
      const cells = sheet.columns.map((c, i) => cell(`${colName(i)}${n}`, row[i], c.type ?? 'text')).join('');
      return `<row r="${n}">${cells}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

export function buildXlsx(sheets: Sheet[]): Buffer {
  const names = new Set<string>();
  for (const s of sheets) {
    if (!s.name || s.name.length > 31 || /[:\\/?*[\]]/.test(s.name) || names.has(s.name)) {
      throw new Error(`nome de aba inválido: ${s.name}`);
    }
    names.add(s.name);
  }
  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    overrides +
    '</Types>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    '</workbook>';
  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  return zip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}

/* ---------------------------------------------------------------- leitura */

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** Junta os <t> de um trecho (texto com formatação vem quebrado em vários <t>; a "leitura fonética" é ignorada). */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return [...clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('');
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Lê uma aba como linhas de texto (números como vieram gravados, ex.: "22990" ou "22990.5").
 * Usa a aba com o nome pedido ou, se não existir, a primeira.
 */
export function readXlsxSheet(buf: Buffer, preferredSheet?: string): string[][] {
  const files = unzip(buf);
  const read = (name: string) => files.get(name)?.toString('utf8');
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('arquivo não é uma planilha .xlsx');
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/g)].map((m) => ({
    name: unescapeXml(m[1]!),
    rid: m[2]!,
  }));
  const chosen = sheets.find((s) => s.name.trim().toLowerCase() === preferredSheet?.toLowerCase()) ?? sheets[0];
  if (!chosen) throw new Error('planilha sem abas');
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => tag.includes(`Id="${chosen.rid}"`))
    ?.match(/Target="([^"]+)"/)?.[1];
  if (!target) throw new Error(`aba "${chosen.name}" não encontrada`);
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheet = read(path);
  if (!sheet) throw new Error(`aba "${chosen.name}" não encontrada`);
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(/\br="(\d+)"/.exec(row[0])?.[1] ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (v !== undefined) value = unescapeXml(v);
      cells[ref ? colIndex(ref) : cells.length] = value.trim();
    }
    rows[r] = Array.from(cells, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}
