import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { formatBRL, formatDate, formatInt, formatTime } from '@lle/shared';
import { StoreLayout } from '../components/Layout';
import { LivePill } from '../components/SiteChrome';
import { MotoCard } from '../components/MotoCard';
import { Thermometer } from '../components/Thermometer';
import { IconEye, IconExternal, IconGift, IconLive, IconPlay } from '../components/Icons';
import { useLive, useNow, useThermometer } from '../lib/live';

/** "19/11 às 10h" (10h30 quando há minutos), no horário de Brasília. */
function formatDeadline(iso: string): string {
  const [h, m] = formatTime(iso).split(':');
  return `${formatDate(iso).slice(0, 5)} às ${Number(h)}h${m === '00' ? '' : m}`;
}

/** Tela de encerramento: a transmissão sai do ar e fica o agradecimento, com o prazo das condições. */
function Closing({ offersUntil }: { offersUntil: string | null }) {
  const now = useNow(1000);
  const left = offersUntil ? Math.max(0, new Date(offersUntil).getTime() - now) : 0;
  const parts: [string, number][] = [
    ['dias', Math.floor(left / 86_400_000)],
    ['horas', Math.floor((left % 86_400_000) / 3_600_000)],
    ['min', Math.floor((left % 3_600_000) / 60_000)],
    ['seg', Math.floor((left % 60_000) / 1000)],
  ];
  return (
    <div className="closing">
      <div className="closing__title">Obrigado por assistir!</div>
      {offersUntil && left > 0 ? (
        <>
          <p className="closing__text">
            A live terminou, mas as condições continuam válidas <strong>neste site até {formatDeadline(offersUntil)}</strong>.
          </p>
          <div className="closing__timer" role="timer" aria-label="Tempo restante das condições da live">
            {parts.map(([label, value]) => (
              <span key={label} className="closing__unit">
                <strong>{String(value).padStart(2, '0')}</strong>
                {label}
              </span>
            ))}
          </div>
          <a className="btn btn--primary btn--sm" href="#motos">
            Ver as motos
          </a>
        </>
      ) : (
        <p className="closing__text">A live terminou e o prazo das condições acabou. Até a próxima!</p>
      )}
    </div>
  );
}

function Player() {
  const { snapshot } = useLive();
  const [playing, setPlaying] = useState(false);
  const live = snapshot?.live;
  const embed = live?.youtubeEmbedUrl;
  // Encerrada: corta a transmissão na hora (mesmo para quem já estava assistindo).
  if (live?.status === 'encerrada') {
    return (
      <div className="player player--closed">
        <Closing offersUntil={live.offersUntil} />
      </div>
    );
  }
  // Com a live "Ao vivo" o vídeo começa sozinho (sem som: os navegadores só deixam tocar automático no mudo).
  // Antes e depois da live o player continua "leve": o iframe do YouTube só carrega no clique.
  const show = Boolean(embed) && (playing || live?.status === 'ao_vivo');
  return (
    <div className="player">
      {show && embed ? (
        <iframe
          src={embed}
          title="Transmissão da Live Limpa Estoque Yamaha"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          // O site envia "Referrer-Policy: no-referrer"; sem informar a origem, o YouTube recusa o player (erro 153).
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <>
          <div className="player__badge">
            <LivePill status={live?.status} small />
          </div>
          <button type="button" aria-label="Reproduzir a live" className="player__play" disabled={!embed} onClick={() => setPlaying(true)}>
            <IconPlay />
          </button>
          <div className="player__note">
            {!embed ? 'A transmissão aparece aqui quando a live começar.' : 'Toque para assistir à transmissão ao vivo'}
          </div>
        </>
      )}
    </div>
  );
}

function SoldBanner() {
  const { snapshot } = useLive();
  const p = useThermometer();
  if (!snapshot || !p) return null;
  return (
    <div className="sold-banner" aria-live="polite">
      <div className="sold-banner__count">
        <span className="sold-banner__num">{p.sold}</span>
        <span className="sold-banner__label">
          {p.sold === 1 ? 'moto vendida' : 'motos vendidas'}
          <br />
          nesta live
        </span>
      </div>
      <span className="sold-banner__sep" />
      <div className="sold-banner__info">
        {/* Sem "Última venda há X min" (pedido de 17/11/2026). Enquanto ninguém comprou, fica só o convite. */}
        {p.sold === 0 && <div className="sold-banner__recent">Seja a primeira pessoa a garantir a sua</div>}
        {snapshot.live.showThermometer && p.next && (
          <div className="sold-banner__goal">
            Faltam <strong className="y">{p.next.remaining}</strong> para liberar <strong>{p.next.prize}</strong> para todo mundo que comprar na live
          </div>
        )}
        {snapshot.live.showThermometer && !p.next && p.goals.length > 0 && (
          <div className="sold-banner__goal">
            <strong className="y">Todas as metas batidas!</strong> Os brindes valem para todo mundo que comprou na live.
          </div>
        )}
      </div>
    </div>
  );
}

function VoucherCard() {
  const { snapshot } = useLive();
  if (!snapshot) return null;
  const { voucherCents } = snapshot.live;
  return (
    <div className="voucher-card">
      <div className="voucher-card__value">
        <span className="voucher-card__kicker">VOUCHER</span>
        <span className="voucher-card__amount">{formatBRL(voucherCents)}</span>
      </div>
      <div className="voucher-card__body">
        <p>
          Garante o preço da live. Pago via Pix ou cartão e abatido da entrada no fechamento. Devolvido integralmente se o crédito não for
          aprovado.
        </p>
        <div className="voucher-card__gift">
          <IconGift />
          <span>Comprando agora você leva também os brindes coletivos já liberados e os que forem desbloqueados até o fim da live.</span>
        </div>
      </div>
    </div>
  );
}

/** "A, B ou C" com os nomes das lojas do painel. */
function storeList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`;
}

const HOW = (holdMinutes: number, stores: string[]) => [
  ['Acompanhe a live', 'As motos aparecem bloqueadas e são liberadas uma a uma conforme o apresentador anuncia. Enquanto espera, veja fotos, cores e ficha técnica.'],
  ['Pague o voucher', `Pix ou cartão. Enquanto o Pix não é pago, a unidade fica segurada para você por ${holdMinutes} minutos. Com o pagamento confirmado, ela fica reservada no seu nome.`],
  ['Feche com a loja', 'Com o voucher pago, o comprovante traz o botão do WhatsApp da loja que você escolheu. É por ali a análise de crédito e o fechamento da compra.'],
  [
    'Retire na loja',
    // Com muitas lojas a lista não cabe na frase: os nomes ficam no checkout e no rodapé.
    `${stores.length > 0 && stores.length <= 4 ? `Na loja que você escolher (${storeList(stores)})` : 'Na loja que você escolher'}, com o voucher abatido da entrada. A data da retirada é combinada com a loja depois da aprovação do crédito.`,
  ],
];

export function StorePage() {
  const { snapshot, error } = useLive();
  const now = useNow(30_000);
  const location = useLocation();
  const ready = snapshot !== null;
  const scrolledFor = useRef<string | null>(null);

  // Atalhos do cabeçalho (#motos, #como-funciona): rola uma vez por clique, quando o conteúdo já existe.
  // Não depende do snapshot inteiro, senão cada atualização da live puxaria a tela de volta para o atalho.
  useEffect(() => {
    if (!location.hash || !ready || scrolledFor.current === location.key) return;
    scrolledFor.current = location.key;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, [location.key, location.hash, ready]);

  // "Voltar à live": aparece quando a pessoa rola a ponto de o vídeo ficar quase todo escondido sob o cabeçalho.
  const playerBox = useRef<HTMLDivElement>(null);
  const [playerHidden, setPlayerHidden] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = playerBox.current;
      if (!el) return;
      const header = document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 0;
      const r = el.getBoundingClientRect();
      setPlayerHidden(r.height > 0 && r.bottom < header + r.height * 0.25);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const live = snapshot?.live;
  const models = snapshot?.models ?? [];
  const released = models.filter((m) => m.released).length;

  return (
    <StoreLayout mobileBar={false} stickyHeader backToLive={playerHidden}>
      <div className="hero">
        <div className="hero__meta">
          <span className="pill-blue">
            <IconLive />
            {live?.status === 'ao_vivo' ? 'AO VIVO NO YOUTUBE' : live?.status === 'encerrada' ? 'LIVE ENCERRADA' : 'LIVE NO YOUTUBE'}
          </span>
        </div>
        <h1 className="display hero__title">
          Live Limpa Estoque <span className="hl">Yamaha</span>
        </h1>
        <p className="hero__lead">
          {/* O valor vem sempre do painel (Transmissão); enquanto carrega, a frase sai sem valor. */}
          Preço de live, estoque limitado e voucher{live ? ` de ${formatBRL(live.voucherCents)}` : ''} abatido da entrada.
        </p>
      </div>

      <div ref={playerBox}>
        <Player />
      </div>
      <div className="viewers">
        {live?.status === 'encerrada' ? (
          <span className="viewers__count">Transmissão encerrada</span>
        ) : (
          <span className="viewers__count">
            <IconEye />
            <span>
              <strong>{formatInt(live?.viewers ?? 0)}</strong> assistindo agora
            </span>
          </span>
        )}
        {live?.youtubeUrl && (
          <a href={live.youtubeUrl} target="_blank" rel="noopener noreferrer">
            Abrir no YouTube
            <IconExternal />
          </a>
        )}
      </div>

      <SoldBanner />
      <div className="mobile-only">
        <Thermometer variant="inline" />
      </div>
      <VoucherCard />

      <div id="motos" className="section-head">
        <h2 className="display">Motos da live</h2>
        {models.length > 0 && (
          <p>
            <strong>
              {released} de {models.length} {released === 1 ? 'liberada' : 'liberadas'} até agora.
            </strong>{' '}
            As motos são liberadas uma a uma conforme o apresentador anuncia. Clique para ver fotos e ficha técnica.
          </p>
        )}
      </div>
      {!snapshot && !error && (
        <div className="grid-motos">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 520 }} />
          ))}
        </div>
      )}
      {error && <div className="empty">Não foi possível carregar as motos. Atualize a página em instantes.</div>}
      {snapshot && models.length === 0 && <div className="empty">As motos da live aparecem aqui em breve.</div>}
      <div className="grid-motos">
        {live && models.map((m) => <MotoCard key={m.id} m={m} live={live} now={now} />)}
      </div>

      <section id="como-funciona" className="how">
        <h2 className="display">
          Como <span>funciona</span>
        </h2>
        <div className="how__grid">
          {HOW(live?.holdMinutes ?? 30, snapshot?.stores.map((s) => s.name) ?? []).map(([title, text], i) => (
            <div key={title} className={`how__step ${i === 3 ? 'how__step--hl' : ''}`}>
              <div className="how__num">{String(i + 1).padStart(2, '0')}</div>
              <div>
                <div className="how__title">{title}</div>
                <div className="how__text">{text}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </StoreLayout>
  );
}
