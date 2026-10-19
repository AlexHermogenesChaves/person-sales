import { idAleatorio } from "../dominio/chaves.js";

// Sessão opaca em memória — premissa do MVP de instância única (D14). Reinício do
// processo derruba todas as sessões; o controle de envio está no SAP e sobrevive.

export type Sessao = {
  id: string;
  csrf: string;
  identityHash: string;
  nome: string;
  email: string;
  criadaEm: number;
  ultimoUso: number;
  /** Login demo: aguardando o segundo fator. */
  mfaPendente: boolean;
};

export type ConfigSessao = {
  inatividadeMs: number;
  absolutaMs: number;
  maximo: number;
};

export class Sessoes {
  private porId = new Map<string, Sessao>();

  constructor(
    private readonly config: ConfigSessao,
    private readonly agora: () => number = Date.now,
  ) {}

  criar(dados: Pick<Sessao, "identityHash" | "nome" | "email" | "mfaPendente">): Sessao {
    this.limpar();
    if (this.porId.size >= this.config.maximo) {
      // Lotado: descarta a mais antiga em vez de recusar login novo.
      const maisAntiga = [...this.porId.values()].sort((a, b) => a.ultimoUso - b.ultimoUso)[0];
      if (maisAntiga) this.porId.delete(maisAntiga.id);
    }
    const t = this.agora();
    const sessao: Sessao = { ...dados, id: novoId(), csrf: novoId(), criadaEm: t, ultimoUso: t };
    this.porId.set(sessao.id, sessao);
    return sessao;
  }

  /** Lê e renova o uso. Expirada por inatividade ou idade some na hora. */
  obter(id: string | undefined): Sessao | null {
    if (!id) return null;
    const sessao = this.porId.get(id);
    if (!sessao) return null;
    const t = this.agora();
    if (t - sessao.ultimoUso > this.config.inatividadeMs || t - sessao.criadaEm > this.config.absolutaMs) {
      this.porId.delete(id);
      return null;
    }
    sessao.ultimoUso = t;
    return sessao;
  }

  /** Rotação após concluir o login (fixação de sessão). */
  rotacionar(sessao: Sessao): Sessao {
    this.porId.delete(sessao.id);
    const nova = { ...sessao, id: novoId(), csrf: novoId(), ultimoUso: this.agora() };
    this.porId.set(nova.id, nova);
    return nova;
  }

  encerrar(id: string | undefined) {
    if (id) this.porId.delete(id);
  }

  private limpar() {
    for (const id of [...this.porId.keys()]) this.obter(id);
  }
}

const novoId = () => idAleatorio(32);
