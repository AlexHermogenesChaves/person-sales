import { useState } from "react";
import { IconeEmbalagem } from "./Embalagem";

/** Foto do produto (origem aprovada) com queda para o ícone da embalagem. */
export function FotoProduto({ src, unidade, alt, grande = false }: { src: string | null | undefined; unidade: string; alt: string; grande?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  if (!src || falhou) return <IconeEmbalagem unidade={unidade} size={grande ? 28 : 20} />;
  return (
    <span className={grande ? "pt-foto pt-foto--grande" : "pt-foto"}>
      <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFalhou(true)} />
    </span>
  );
}
