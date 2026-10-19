import { useEffect, useState, type FormEvent } from "react";
import { api, ErroDaApi } from "../api";
import { Button, Card, EmptyState, Input, SkeletonRows } from "../ui";
import { IconEscudo } from "../ui/icons";
import { LogoMarca, NOME_MARCA } from "../ui/Marca";

// Logos das marcas do grupo, servidos pelo CDN do site do cliente (nada baixado aqui).
const CDN = "https://static.wixstatic.com/media";
const MARCAS = [
  { nome: "Pita Bread", linha: "Pães sírios e hambúrguer", logo: `${CDN}/b09142_c4c8debbc3d1435c92e476c26ab5e714~mv2.avif/v1/fit/w_200,h_120,q_90,enc_auto/pita.png` },
  { nome: "Reali Junior", linha: "Pães de forma e bisnaguinha", logo: `${CDN}/b09142_91e9a97f0e5a4f58a9a26e0e5224f259~mv2.avif/v1/fit/w_200,h_120,q_90,enc_auto/reali.png` },
  { nome: "Cabocla Mineira", linha: "Bolos caseiros", logo: `${CDN}/b09142_039879d7e50e424595cd043feeace5bc~mv2.png/v1/fit/w_200,h_120,q_90,enc_auto/cabocla.png` },
  { nome: "Tá Pronto", linha: "Tortilhas", logo: `${CDN}/8779b2_a8658d9ef3cd4c9d9538d7d0199c4d66~mv2.png/v1/fit/w_200,h_120,q_90,enc_auto/tapronto.png` },
];

type Pessoa = { chave: string; nome: string; email: string; descricao: string };

/**
 * Substitui o provedor de identidade nesta POC. Na implantação o botão "Entrar"
 * redireciona para o OIDC da empresa (Authorization Code + PKCE) e o MFA é dele.
 */
export function Entrar({ aviso, onEntrou }: { aviso?: string; onEntrou: () => void }) {
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [codigoTeste, setCodigoTeste] = useState("");
  const [falhaLista, setFalhaLista] = useState(false);
  const [escolhida, setEscolhida] = useState<Pessoa | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<{ pessoas: Pessoa[]; codigoMfa: string }>("/auth/demo/pessoas")
      .then(({ dados }) => {
        setPessoas(dados.pessoas);
        setCodigoTeste(dados.codigoMfa);
      })
      .catch(() => setFalhaLista(true));
  }, []);

  const escolher = async (p: Pessoa) => {
    setErro("");
    setOcupado(true);
    try {
      await api("/auth/demo/login", { method: "POST", body: { pessoa: p.chave } });
      setEscolhida(p);
      setCodigo("");
    } catch (e) {
      setErro((e as ErroDaApi).message);
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async (ev: FormEvent) => {
    ev.preventDefault();
    setErro("");
    setOcupado(true);
    try {
      await api("/auth/demo/mfa", { method: "POST", body: { codigo } });
      onEntrou();
    } catch (e) {
      setErro((e as ErroDaApi).message);
      setOcupado(false);
    }
  };

  return (
    <div className="pt-entrar">
      <section className="pt-entrar__marca" aria-label={NOME_MARCA}>
        <div className="pt-entrar__selo">
          <LogoMarca altura={96} desenhar />
          <span className="pt-entrar__oficio">Indústria brasileira de panificação · Atibaia/SP</span>
        </div>
        <div>
          <h1 className="pt-entrar__titulo">Variedade e tradição em panificação</h1>
          <p className="pt-entrar__lead">
            O portal de pedidos dos nossos clientes: o preço do seu contrato, o pedido direto na programação da fábrica e o acompanhamento até a nota — o que foi aprovado, faturado e o que ainda falta chegar.
          </p>
        </div>
        <ul className="pt-entrar__marcas" aria-label="Marcas do grupo">
          {MARCAS.map((m) => (
            <li key={m.nome} title={m.linha}>
              <img src={m.logo} alt={m.nome} loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
              <span>{m.linha}</span>
            </li>
          ))}
        </ul>
      </section>

      <Card
        className="pt-entrar__card"
        title={escolhida ? "Verificação em duas etapas" : "Entrar no portal"}
        description={escolhida ? `Código enviado ao aplicativo autenticador de ${escolhida.nome}.` : "Ambiente de demonstração: escolha uma identidade de teste."}
      >
        {aviso && !escolhida && <p className="pt-aviso pt-aviso--info" role="status">{aviso}</p>}
        {erro && <p className="pt-aviso pt-aviso--erro" role="alert">{erro}</p>}

        {!escolhida && (
          <>
            {falhaLista && <EmptyState variant="error" title="Não foi possível carregar as identidades de teste" />}
            {!pessoas && !falhaLista && <SkeletonRows rows={4} />}
            {pessoas && (
              <ul className="pt-pessoas">
                {pessoas.map((p) => (
                  <li key={p.chave}>
                    <button type="button" className="pt-pessoa" onClick={() => escolher(p)} disabled={ocupado}>
                      <span className="pt-pessoa__iniciais" aria-hidden="true">
                        {p.nome.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </span>
                      <span className="pt-pessoa__texto">
                        <strong>{p.nome}</strong>
                        <span>{p.email}</span>
                        <span className="nh-caption">{p.descricao}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="nh-caption pt-entrar__nota">
              <IconEscudo size={14} /> Na implantação, esta etapa é o provedor de identidade da empresa (OIDC com MFA). O portal não guarda senha.
            </p>
          </>
        )}

        {escolhida && (
          <form onSubmit={confirmar} className="pt-mfa">
            <Input
              label="Código de 6 dígitos"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              hint={`Código de teste: ${codigoTeste}`}
              autoFocus
              required
            />
            <div className="pt-mfa__acoes">
              <Button variant="ghost" onClick={() => setEscolhida(null)}>
                Trocar usuário
              </Button>
              <Button variant="primary" type="submit" loading={ocupado} disabled={codigo.length !== 6}>
                Confirmar
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
