/**
 * Aceita o que a equipe colar no painel: link do vídeo (watch, youtu.be, /live/, /embed/),
 * o ID do vídeo ou o ID do canal (UC...). Devolve o player incorporado e o link público.
 */
export function youtubeLinks(input: string | null): { embedUrl: string; watchUrl: string } | null {
  if (!input) return null;
  const value = input.trim();
  const channel = value.match(/(?:youtube\.com\/channel\/)?(UC[\w-]{22})\b/);
  if (channel) {
    return {
      embedUrl: `https://www.youtube-nocookie.com/embed/live_stream?channel=${channel[1]}&autoplay=1&mute=1`,
      watchUrl: `https://www.youtube.com/channel/${channel[1]}/live`,
    };
  }
  let id: string | null = null;
  if (/^[\w-]{11}$/.test(value)) id = value;
  else {
    try {
      const url = new URL(value);
      if (url.hostname === 'youtu.be') id = url.pathname.slice(1, 12);
      else if (/(^|\.)youtube(-nocookie)?\.com$/.test(url.hostname)) {
        id = url.searchParams.get('v') ?? url.pathname.match(/\/(?:live|embed|shorts)\/([\w-]{11})/)?.[1] ?? null;
      }
    } catch {
      return null;
    }
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  return {
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&rel=0`,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}
