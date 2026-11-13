import { onlyDigits } from '@lle/shared';

/** "Chamar amigos para a live": compartilhamento nativo no celular, cópia do link no desktop. */
export async function shareLive(): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = `${location.origin}/`;
  const data = {
    title: 'Live Limpa Estoque Yamaha',
    text: 'Tô na Live Limpa Estoque da Yamaha: preço de live e brindes que liberam pra todo mundo conforme as vendas. Vem!',
    url,
  };
  if (navigator.share) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await copyText(`${data.text} ${url}`);
  return 'copied';
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function whatsappLink(phoneE164: string, message: string): string {
  return `https://wa.me/${onlyDigits(phoneE164)}?text=${encodeURIComponent(message)}`;
}

