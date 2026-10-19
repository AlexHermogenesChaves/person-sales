// Janela deslizante em memória. No gateway real os limites também existem; este é
// o segundo anel, por usuário e por cliente, que o gateway não conhece.

export class Limitador {
  private eventos = new Map<string, number[]>();

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Registra a tentativa. Devolve os segundos de espera, ou 0 se liberado. */
  consumir(chave: string): number {
    const t = this.agora();
    const recentes = (this.eventos.get(chave) ?? []).filter((e) => t - e < this.janelaMs);
    if (recentes.length >= this.maximo) {
      this.eventos.set(chave, recentes);
      return Math.max(1, Math.ceil((this.janelaMs - (t - recentes[0])) / 1000));
    }
    recentes.push(t);
    this.eventos.set(chave, recentes);
    return 0;
  }
}
