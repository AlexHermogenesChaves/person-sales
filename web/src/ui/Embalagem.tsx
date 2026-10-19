import type { ReactNode } from "react";

// Ícone da embalagem de venda no lugar da foto que não temos: o comprador do
// varejo reconhece caixa, fardo e pacote antes de ler a descrição.

type P = { unidade: string; size?: number };

const DESENHOS: Record<string, ReactNode> = {
  SC: (
    <>
      <path d="M8 6.5c1.5-1.2 6.5-1.2 8 0l1.4 3.2c1.2 2.8 1.2 6.9 0 9.7-.4.9-1.3 1.6-2.3 1.6H8.9c-1 0-1.9-.7-2.3-1.6-1.2-2.8-1.2-6.9 0-9.7z" />
      <path d="M8.2 6.6 9.5 4m6.3 2.6L14.5 4M9.5 13h5" />
    </>
  ),
  CX: (
    <>
      <path d="M4 8.5 12 5l8 3.5v8L12 20l-8-3.5z" />
      <path d="M4 8.5 12 12l8-3.5M12 12v8M8 6.7l8 3.5" />
    </>
  ),
  BD: (
    <>
      <path d="M5.5 8h13l-1.4 10.6a1.6 1.6 0 0 1-1.6 1.4h-7a1.6 1.6 0 0 1-1.6-1.4z" />
      <path d="M5 8h14M8 8c0-3 1.8-4.5 4-4.5S16 5 16 8" />
    </>
  ),
  FD: (
    <>
      <rect x="4" y="11" width="7.5" height="8.5" rx="1.2" />
      <rect x="12.5" y="11" width="7.5" height="8.5" rx="1.2" />
      <rect x="8.2" y="3.5" width="7.5" height="7" rx="1.2" />
    </>
  ),
  UN: (
    <>
      <path d="M7 4h10l1 3v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7z" />
      <path d="M6 7h12M10 12h4" />
    </>
  ),
};

export function IconeEmbalagem({ unidade, size = 20 }: P) {
  return (
    <span className="pt-embalagem" aria-hidden="true" data-unidade={unidade}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {DESENHOS[unidade] ?? DESENHOS.UN}
      </svg>
    </span>
  );
}
