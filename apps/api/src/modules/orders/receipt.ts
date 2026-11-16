import PDFDocument from 'pdfkit';
import { formatBRL, formatBrPhone, formatDateTime, type OrderView } from '@lle/shared';

const YELLOW = '#FFCE00';
const INK = '#1B1B1B';
const GREY = '#5C5C5C';
const BLUE = '#1F62EA';

type Store = { legalName: string; cnpj: string | null };

function toBuffer(doc: PDFKit.PDFDocument, draw: () => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw();
    doc.end();
  });
}

/** Comprovante do voucher em PDF (mesmas informações do cartão "Reserva confirmada"). */
export function renderReceiptPdf(view: OrderView, store: Store): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Voucher ${view.code}`, Author: store.legalName } });
  return toBuffer(doc, () => drawReceipt(doc, view, store));
}

/** Vários comprovantes num PDF só, um por página (relatório para os gerentes das lojas). */
export function renderReceiptsPdf(views: OrderView[], store: Store, title: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, autoFirstPage: false, info: { Title: title, Author: store.legalName } });
  return toBuffer(doc, () => {
    if (views.length === 0) {
      doc.addPage().font('Helvetica').fontSize(12).fillColor(INK).text(`${title}: nenhuma venda paga.`, 48, 64);
      return;
    }
    for (const view of views) {
      doc.addPage();
      drawReceipt(doc, view, store);
    }
  });
}

function drawReceipt(doc: PDFKit.PDFDocument, view: OrderView, store: Store): void {
  const width = doc.page.width - 96;
  doc.rect(48, 48, width, 92).fill(YELLOW);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('VOUCHER · GERAÇÃO YAMAHA', 68, 66, { characterSpacing: 1.2 });
  doc.font('Helvetica-Bold').fontSize(30).text(view.code, 68, 84);

  const rows: [string, string][] = [
    ['Cliente', view.customer.name],
    ['CPF', view.customer.cpfMasked],
    ['WhatsApp', formatBrPhone(view.customer.whatsapp)],
    ['Moto', view.model.name],
    ...(view.preferredColor ? ([['Cor de preferência', view.preferredColor]] as [string, string][]) : []),
    ['Preço garantido', formatBRL(view.priceLiveCents)],
    ['Pago', `${formatBRL(view.voucherCents)} via ${view.paidWith === 'card' ? 'cartão de crédito' : 'Pix'}`],
    ['Transação Mercado Pago', view.payment ? `nº ${view.payment.id}` : '-'],
    ['Loja de preferência', view.store.name],
    ...(view.storeWhatsapp ? ([['WhatsApp do gerente da loja', formatBrPhone(view.storeWhatsapp)]] as [string, string][]) : []),
    ['Data', view.paidAt ? formatDateTime(view.paidAt) : '-'],
  ];
  let y = 164;
  for (const [label, value] of rows) {
    doc.moveTo(48, y - 8).lineTo(48 + width, y - 8).strokeColor('#E6E7EA').lineWidth(1).stroke();
    doc.font('Helvetica').fontSize(11).fillColor(GREY).text(label, 48, y, { width: 180 });
    doc.font('Helvetica-Bold').fillColor(INK).text(value, 230, y, { width: width - 182, align: 'right' });
    y += 28; // 12 linhas (com a cor de preferência) precisam caber acima do rodapé
  }

  y += 10;
  doc.roundedRect(48, y, width, 54, 8).fill('#EEF3FE');
  doc
    .font('Helvetica')
    .fontSize(10.5)
    .fillColor(BLUE)
    .text(
      'Valor abatido da entrada no fechamento. Devolução integral se o crédito não for aprovado.',
      64,
      y + 14,
      { width: width - 32 },
    );

  y += 84;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('O que acontece agora', 48, y);
  const steps = [
    `Chame o gerente da loja ${view.store.name} no WhatsApp e mande este comprovante.`,
    'Envie RG ou CNH e comprovante de renda pelo WhatsApp para a análise de crédito.',
    `Com o crédito aprovado, o gerente combina com você o fechamento da compra e a retirada na loja ${view.store.name}.`,
  ];
  y += 24;
  steps.forEach((s, i) => {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BLUE).text(`${i + 1}.`, 48, y, { width: 20 });
    doc.font('Helvetica').fillColor(INK).text(s, 70, y, { width: width - 22 });
    y = doc.y + 8;
  });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(GREY)
    .text(
      `${store.legalName}${store.cnpj ? ` · CNPJ ${store.cnpj}` : ''} · Via Expressa · Centro · Sul da Ilha · Florianópolis/SC. ` +
        `Pagamento processado pelo Mercado Pago. O código ${view.code} é único e identifica esta reserva. ` +
        'A nota fiscal da moto é emitida pela loja no faturamento.',
      48,
      doc.page.height - 100,
      { width },
    );
}
