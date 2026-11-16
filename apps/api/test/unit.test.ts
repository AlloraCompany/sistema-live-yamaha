import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toMpDate, verifyMercadoPagoSignature } from '../src/modules/payments/mercadopago.js';
import { paymentOutcome } from '../src/modules/payments/gateway.js';
import { youtubeLinks } from '../src/modules/live/youtube.js';
import { cardRejectionMessage } from '../src/modules/orders/service.js';
import { hashPassword, verifyPassword, voucherCode } from '../src/lib/crypto.js';
import { loadConfig } from '../src/config.js';
import { buildXlsx } from '../src/modules/reports/xlsx.js';
import { unzip as unzipRaw } from '../src/lib/zip.js';

const unzip = (b: Buffer) => new Map([...unzipRaw(b)].map(([k, v]) => [k, v.toString('utf8')]));

describe('assinatura do webhook do Mercado Pago', () => {
  const secret = 'segredo';
  const sign = (manifest: string) => createHmac('sha256', secret).update(manifest).digest('hex');

  it('aceita assinatura correta (manifesto id;request-id;ts)', () => {
    const v1 = sign('id:123456;request-id:abc-1;ts:1704908010;');
    expect(
      verifyMercadoPagoSignature({ secret, signatureHeader: `ts=1704908010,v1=${v1}`, requestId: 'abc-1', dataId: '123456' }),
    ).toBe(true);
  });
  it('converte data.id alfanumérico para minúsculas', () => {
    const v1 = sign('id:abc123;request-id:r;ts:1;');
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: `ts=1,v1=${v1}`, requestId: 'r', dataId: 'ABC123' })).toBe(true);
  });
  it('rejeita assinatura adulterada, header ausente ou id trocado', () => {
    const v1 = sign('id:1;request-id:r;ts:1;');
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: `ts=1,v1=${v1}`, requestId: 'r', dataId: '2' })).toBe(false);
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: undefined, requestId: 'r', dataId: '1' })).toBe(false);
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: 'ts=1,v1=zz', requestId: 'r', dataId: '1' })).toBe(false);
  });
});

describe('Mercado Pago', () => {
  it('formata a expiração do Pix no horário de Brasília com milissegundos', () => {
    expect(toMpDate(new Date('2026-11-18T22:42:00.000Z'))).toBe('2026-11-18T19:42:00.000-03:00');
  });
  it('agrupa os status pelo efeito no pedido', () => {
    expect(paymentOutcome('approved')).toBe('approved');
    expect(paymentOutcome('in_process')).toBe('pending');
    expect(paymentOutcome('rejected')).toBe('failed');
    expect(paymentOutcome('cancelled')).toBe('failed');
    expect(paymentOutcome('charged_back')).toBe('reversed');
  });
  it('explica recusas de cartão em português', () => {
    expect(cardRejectionMessage('cc_rejected_insufficient_amount')).toMatch(/limite/);
    expect(cardRejectionMessage(null)).toMatch(/não aprovado/);
  });
});

describe('YouTube', () => {
  it('aceita link de vídeo, link de live, ID de vídeo e ID de canal', () => {
    expect(youtubeLinks('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.embedUrl).toContain('/embed/dQw4w9WgXcQ');
    expect(youtubeLinks('https://youtu.be/dQw4w9WgXcQ')?.watchUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(youtubeLinks('https://www.youtube.com/live/dQw4w9WgXcQ?si=x')?.embedUrl).toContain('dQw4w9WgXcQ');
    expect(youtubeLinks('UCabcdefghijklmnopqrstuv')?.embedUrl).toContain('live_stream?channel=UCabcdefghijklmnopqrstuv');
    expect(youtubeLinks('youtube.com/live/oiX0yOjXZco?feature=share')?.embedUrl).toContain('/embed/oiX0yOjXZco');
    expect(youtubeLinks('www.youtube.com/watch?v=dQw4w9WgXcQ')?.watchUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(youtubeLinks('não é link')).toBeNull();
    expect(youtubeLinks('https://exemplo.com/live/oiX0yOjXZco')).toBeNull();
  });
});

describe('segurança', () => {
  it('hash de senha com scrypt confere e não aceita senha errada', async () => {
    const h = await hashPassword('SenhaForte123');
    expect(await verifyPassword('SenhaForte123', h)).toBe(true);
    expect(await verifyPassword('senhaforte123', h)).toBe(false);
  });
  it('código de voucher sem caracteres ambíguos', () => {
    for (let i = 0; i < 200; i++) expect(voucherCode()).toMatch(/^LLE-[0-9A-HJKMNP-TV-Z]{6}$/);
  });
  it('produção exige credenciais do Mercado Pago e a senha do painel', () => {
    const prod = { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://x.test', DATABASE_URL: 'postgres://x' };
    expect(() => loadConfig(prod)).toThrow(/MP_ACCESS_TOKEN/);
    expect(() => loadConfig(prod)).toThrow(/ADMIN_PASSWORD/);
    expect(() => loadConfig({ ...prod, ADMIN_PASSWORD: 'curta1' })).toThrow(/12 caracteres/);
    // Ensaio antes das credenciais: sobe sem Mercado Pago só com a liberação explícita, e nunca sem a senha.
    const rehearsal = { ...prod, ALLOW_START_WITHOUT_PAYMENTS: 'true' };
    expect(loadConfig({ ...rehearsal, ADMIN_PASSWORD: 'SenhaDoEnsaio2026' }).MP_ACCESS_TOKEN).toBeUndefined();
    expect(() => loadConfig(rehearsal)).toThrow(/ADMIN_PASSWORD/);
  });
});

describe('planilha do relatório (.xlsx sem dependências)', () => {
  it('gera abas, valores em R$ e escapa o texto (fórmula digitada vira texto)', () => {
    const file = buildXlsx([
      {
        name: 'Vendas',
        columns: [
          { header: 'Código do voucher', width: 18 },
          { header: 'Voucher pago', width: 14, type: 'money' },
        ],
        rows: [
          ['LLE-7K2Q9M', 1000],
          ['=HYPERLINK("x") & <b>João</b>', null],
        ],
      },
      { name: 'Resumo', columns: [{ header: 'Loja', width: 20 }], rows: [] },
    ]);
    const files = unzip(file);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']),
    );
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Vendas" sheetId="1" r:id="rId1"/>');
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Código do voucher</t></is></c>');
    expect(sheet).toContain('<c r="B2" s="2"><v>1000</v></c>');
    expect(sheet).toContain('=HYPERLINK(&quot;x&quot;) &amp; &lt;b&gt;João&lt;/b&gt;');
    expect(sheet).not.toContain('<f>');
    expect(sheet).not.toContain('r="B3"');
  });

  it('recusa nome de aba inválido ou repetido', () => {
    const sheet = { columns: [{ header: 'A', width: 5 }], rows: [] };
    expect(() => buildXlsx([{ ...sheet, name: 'Vendas/Loja' }])).toThrow(/aba inválido/);
    expect(() => buildXlsx([{ ...sheet, name: 'A' }, { ...sheet, name: 'A' }])).toThrow(/aba inválido/);
  });
});
