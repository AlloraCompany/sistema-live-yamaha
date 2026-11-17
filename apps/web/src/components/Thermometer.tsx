import { useEffect, useRef, useState } from 'react';
import { nextGoalSentence, type ThermometerProgress } from '@lle/shared';
import { useThermometer, useLive } from '../lib/live';
import { shareLive } from '../lib/browser';
import { IconCheck, IconChevronUp, IconClose, IconGift, IconShare } from './Icons';
import { useToast } from './Toast';

// Geometria do wireframe: cada meta ocupa 110px de tubo; base de 23,5px acima do bulbo.
const SLOT = 110;
const BASE = 23.5;

function Gauge({ p }: { p: ThermometerProgress }) {
  const n = Math.max(p.goals.length, 1);
  const tube = 42 + SLOT * n;
  const height = tube + 56;
  const fill = Math.min(tube - 3, BASE + SLOT * n * p.fill);
  const desc = [...p.goals].reverse(); // maior meta no topo
  return (
    <div className="thermo__body">
      <div className="thermo__gauge" role="img" aria-label={`Termômetro da live: ${p.sold} motos vendidas`} style={{ height }}>
        <div className="thermo__tube" style={{ height: tube }}>
          <div className="thermo__fill" style={{ height: fill }} />
          {desc.map((g, i) => (
            <div key={g.id} className="thermo__tick" style={{ top: i * SLOT + 17 }} />
          ))}
        </div>
        <div className="thermo__bulb" style={{ top: tube - 28 }}>
          <b>{p.sold}</b>
          <small>VENDIDAS</small>
        </div>
      </div>
      <div className="thermo__goals" style={{ height }}>
        {desc.map((g, i) => (
          <div key={g.id} className={`goal ${g.state === 'next' ? 'goal--next' : g.state === 'achieved' ? 'goal--done' : ''}`} style={{ top: i * SLOT }}>
            <span className="goal__k">
              {g.threshold} MOTOS
              {g.state === 'next' && <span className="goal__tag">PRÓXIMA META</span>}
              {g.state === 'achieved' && <span className="goal__tag">LIBERADO</span>}
            </span>
            <span className="goal__prize" title={g.prize}>
              {g.prize}
            </span>
            <span className="goal__left">{g.state === 'achieved' ? 'liberado para todos' : `faltam ${g.remaining}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShareButton() {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn btn--outline btn--block btn--md"
      onClick={async () => {
        const r = await shareLive();
        if (r === 'copied') toast('Link da live copiado. Cole no WhatsApp dos amigos!');
      }}
    >
      <IconShare />
      Chamar amigos para a live
    </button>
  );
}

/** Termômetro completo: lateral fixa no desktop, bloco na loja mobile. */
export function Thermometer({ variant = 'aside' }: { variant?: 'aside' | 'inline' }) {
  const p = useThermometer();
  const { snapshot } = useLive();
  if (!p || !snapshot?.live.showThermometer || p.goals.length === 0) return null;
  return (
    <aside aria-label="Termômetro de metas da live" className={`thermo ${variant === 'inline' ? 'thermo--inline' : ''}`}>
      <div>
        <div className="thermo__title">Termômetro da live</div>
        <div className="thermo__sub">Quanto mais motos vendidas, mais brindes todo mundo ganha</div>
      </div>
      <Gauge p={p} />
      <div className="thermo__note">
        Os brindes valem para todo mundo que comprar na live, inclusive quem comprou antes de a meta ser batida.
      </div>
      <ShareButton />
    </aside>
  );
}

/**
 * Termômetro da loja no celular (aprovado em 17/11/2026): contador, frase da próxima meta, trilha com um
 * trecho por meta e os brindes em linhas. Substitui o banner azul + termômetro em pé, que repetiam a
 * mesma informação em duas telas de altura.
 */
export function ThermoCard() {
  const p = useThermometer();
  const { snapshot } = useLive();
  const toast = useToast();
  const show = Boolean(snapshot?.live.showThermometer);
  const done = p && show ? p.goals.filter((g) => g.state === 'achieved') : [];
  const doneKey = done.map((g) => g.id).join(',');
  const before = useRef<string | null>(null);
  const [fresh, setFresh] = useState<number[]>([]);

  // Meta batida enquanto a pessoa está na página: o brinde pisca e sai um aviso.
  useEffect(() => {
    if (!p) return;
    const prev = before.current;
    before.current = doneKey;
    if (prev === null) return;
    const old = prev ? prev.split(',').map(Number) : [];
    const novas = done.filter((g) => !old.includes(g.id));
    const last = novas[novas.length - 1];
    if (!last) return;
    setFresh(novas.map((g) => g.id));
    toast(`Meta batida! ${last.prize} liberado para todo mundo que comprou.`);
    const t = window.setTimeout(() => setFresh([]), 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey, p === null]);

  if (!p) return null;
  const goals = show ? p.goals : [];
  let prev = 0;
  const parts = goals.map((g) => {
    const part = g.state === 'achieved' ? 1 : g.state === 'next' ? Math.max(0, (p.sold - prev) / (g.threshold - prev)) : 0;
    prev = g.threshold;
    return part;
  });
  return (
    <section className="tcard" aria-label="Termômetro de metas da live" aria-live="polite">
      <div className="tcard__top">
        <span className="tcard__num">{p.sold}</span>
        <span className="tcard__lbl">
          <b>{p.sold === 1 ? 'moto vendida' : 'motos vendidas'}</b>
          nesta live
        </span>
        <button
          type="button"
          className="tcard__share"
          onClick={async () => {
            const r = await shareLive();
            if (r === 'copied') toast('Link da live copiado. Cole no WhatsApp dos amigos!');
          }}
        >
          <IconShare size={16} />
          Convidar
        </button>
      </div>
      {goals.length > 0 && p.next && (
        <p className="tcard__next">
          Faltam <b className="y">{p.next.remaining}</b> para liberar <b>{p.next.prize}</b> para todo mundo que comprou!
        </p>
      )}
      {goals.length > 0 && !p.next && (
        <p className="tcard__next">
          <b className="y">Todas as metas batidas!</b> Os brindes valem para todo mundo que comprou na live.
        </p>
      )}
      {goals.length === 0 && p.sold === 0 && <p className="tcard__next">Seja a primeira pessoa a garantir a sua.</p>}
      {goals.length > 0 && (
        <>
          <div className="tcard__track" aria-hidden="true">
            {goals.map((g, i) => (
              <div key={g.id} className={`tseg ${g.state === 'achieved' ? 'tseg--ok' : ''}`}>
                <div className="tseg__bar">
                  <div className="tseg__fill" style={{ width: `${((parts[i] ?? 0) * 100).toFixed(1)}%` }} />
                </div>
                <span className="tseg__n">{g.threshold}</span>
              </div>
            ))}
          </div>
          <ol className="tcard__goals">
            {goals.map((g) => (
              <li
                key={g.id}
                className={`tgoal ${g.state === 'achieved' ? 'tgoal--done' : g.state === 'next' ? 'tgoal--next' : ''} ${fresh.includes(g.id) ? 'tgoal--new' : ''}`}
              >
                <span className="tgoal__ic">{g.state === 'achieved' ? <IconCheck size={18} strokeWidth={3.2} /> : <IconGift size={18} color="currentColor" />}</span>
                <span className="tgoal__tx">
                  <b>{g.prize}</b>
                  <span>com {g.threshold} motos vendidas</span>
                </span>
                {g.state === 'achieved' ? <span className="tgoal__st tgoal__st--pill">LIBERADO</span> : <span className="tgoal__st">faltam {g.remaining}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function ProgressBar({ p }: { p: ThermometerProgress }) {
  const n = p.goals.length;
  return (
    <div className="progress" aria-hidden="true">
      <div className="progress__fill" style={{ width: `${(p.fill * 100).toFixed(1)}%` }} />
      {p.goals.map((g, i) => (
        <span key={g.id} className="progress__mark" style={{ left: `calc(${(((i + 1) / n) * 100).toFixed(2)}% - 3px)` }} />
      ))}
    </div>
  );
}

function BarHead({ p, action }: { p: ThermometerProgress; action: React.ReactNode }) {
  const sentence = nextGoalSentence(p);
  return (
    <>
      <div className="thermo-bar__row">
        <span className="thermo-bar__num">{p.sold}</span>
        <span className="thermo-bar__txt">
          <b>vendidas na live</b>
          <span>{p.next ? `${sentence} para todos` : sentence}</span>
        </span>
        {action}
      </div>
      <ProgressBar p={p} />
    </>
  );
}

/** Barra fixa inferior (mobile) que abre o termômetro completo numa folha. */
export function ThermoBar() {
  const p = useThermometer();
  const { snapshot } = useLive();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!p || !snapshot?.live.showThermometer || p.goals.length === 0) return null;
  return (
    <div className="mobile-only">
      <div className="thermo-bar">
        <BarHead
          p={p}
          action={
            <button type="button" className="thermo-bar__open" aria-label="Abrir termômetro da live" onClick={() => setOpen(true)}>
              <IconChevronUp />
            </button>
          }
        />
      </div>
      {open && (
        <>
          <div className="sheet-backdrop" onClick={() => setOpen(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Termômetro da live">
            <div className="sheet__head">
              <BarHead
                p={p}
                action={
                  <button ref={closeRef} type="button" className="thermo-bar__open" aria-label="Fechar termômetro" onClick={() => setOpen(false)}>
                    <IconClose />
                  </button>
                }
              />
            </div>
            <div className="sheet__body">
              <div>
                <div className="thermo__title">Termômetro da live</div>
                <div className="thermo__sub">Quanto mais motos vendidas, mais brindes todo mundo ganha</div>
              </div>
              <Gauge p={p} />
              <div className="thermo__note">
                Os brindes valem para todo mundo que comprar na live, inclusive quem comprou antes de a meta ser batida.
              </div>
              <ShareButton />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
