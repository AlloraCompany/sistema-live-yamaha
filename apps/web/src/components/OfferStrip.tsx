import { useState, type ReactNode } from 'react';

/**
 * PROTÓTIPO da "testeira" sugerida pelo designer para a página de compra do voucher:
 * faixa com produtos e serviços para a moto. Só aparece em desenvolvimento (npm run dev);
 * o build de produção não inclui. Itens de exemplo, sem preço e sem efeito na compra.
 * Ideia em avaliação: a pessoa marca o que interessa e o consultor apresenta na retirada.
 */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ITEMS: { id: string; title: string; text: string; icon: ReactNode }[] = [
  {
    id: 'capacete',
    title: 'Capacete e vestuário',
    text: 'Capacete, jaqueta e luvas para sair rodando',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M3 16a9 9 0 0 1 18 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
        <path d="M12 12h9" />
      </svg>
    ),
  },
  {
    id: 'acessorios',
    title: 'Acessórios originais',
    text: 'Baú, protetor de motor, suporte de celular',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <rect x="4" y="7" width="16" height="12" rx="2" />
        <path d="M9 7V5h6v2M4 12h16" />
      </svg>
    ),
  },
  {
    id: 'seguro',
    title: 'Seguro da moto',
    text: 'Saia da loja com a moto protegida',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M12 3 19 6v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'revisoes',
    title: 'Revisões programadas',
    text: 'Plano de manutenção com a oficina da loja',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
      </svg>
    ),
  },
];

export function OfferStrip() {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <section className="offer-strip" aria-labelledby="offer-strip-title">
      <span className="offer-strip__proto">PROTÓTIPO · itens de exemplo, sem efeito na compra</span>
      <div className="offer-strip__head">
        <h2 id="offer-strip-title" className="display">
          Complete <span className="hl">sua moto</span>
        </h2>
        <p>Marque o que te interessa. O consultor apresenta as condições da loja na retirada, sem compromisso.</p>
      </div>
      <div className="offer-strip__items">
        {ITEMS.map((item) => {
          const on = picked.includes(item.id);
          return (
            <button key={item.id} type="button" className={`offer ${on ? 'offer--on' : ''}`} aria-pressed={on} onClick={() => toggle(item.id)}>
              <span className="offer__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="offer__body">
                <span className="offer__title">{item.title}</span>
                <span className="offer__text">{item.text}</span>
              </span>
              <span className="offer__cta">{on ? '✓ Tenho interesse' : 'Tenho interesse'}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
