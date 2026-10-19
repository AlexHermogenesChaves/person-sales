import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, definirCsrf, ErroDaApi, quandoSessaoExpirar, type Eu } from "./api";
import { abrirCarrinho, fecharCarrinho, useCarrinho } from "./estado";
import { useRota, type Rota } from "./rotas";
import { definirTema, proximoTema, useTema, type Tema } from "./tema";
import { Bastidores } from "./telas/Bastidores";
import { Carrinho } from "./telas/Carrinho";
import { Catalogo } from "./telas/Catalogo";
import { Entrar } from "./telas/Entrar";
import { Inicio } from "./telas/Inicio";
import { ItensPrecos } from "./telas/ItensPrecos";
import { Protocolo } from "./telas/Protocolo";
import { Revisao } from "./telas/Revisao";
import { SemAcesso } from "./telas/SemAcesso";
import { Button, EmptyState, Skeleton } from "./ui";
import { IconBastidores, IconBox, IconBuilding, IconCarrinho, IconChart, IconInbox, IconLua, IconPanelLeft, IconSair, IconSol } from "./ui/icons";
import { MarcaCliente, NOME_MARCA } from "./ui/Marca";

type Sessao =
  | { tipo: "carregando" }
  | { tipo: "anonimo"; aviso?: string }
  | { tipo: "sem-acesso"; erro: ErroDaApi }
  | { tipo: "indisponivel"; mensagem: string }
  | { tipo: "ativa"; eu: Eu };

export function App() {
  const [sessao, setSessao] = useState<Sessao>({ tipo: "carregando" });
  const [bastidores, setBastidores] = useState(false);
  const [modoSap, setModoSap] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { dados } = await api<Eu>("/api/v1/me");
      definirCsrf(dados.csrfToken);
      abrirCarrinho(dados.customer.code, dados.user.email);
      setModoSap(dados.sapMode);
      setSessao({ tipo: "ativa", eu: dados });
    } catch (e) {
      const erro = e as ErroDaApi;
      if (erro.status === 401) return setSessao({ tipo: "anonimo" });
      if (erro.status === 403) {
        definirCsrf(String(erro.corpo.csrfToken ?? ""));
        return setSessao({ tipo: "sem-acesso", erro });
      }
      setSessao({ tipo: "indisponivel", mensagem: erro.message });
    }
  }, []);

  useEffect(() => {
    // Expirou: volta ao login sem apagar o carrinho desta aba.
    quandoSessaoExpirar(() => {
      setSessao({ tipo: "anonimo", aviso: "Sua sessão expirou. Entre novamente — o carrinho desta aba foi mantido." });
    });
    void carregar();
    // Sem sessão a página não sabe se é demo; pergunta ao servidor pelos bastidores.
    fetch("/demo/estado").then((r) => setModoSap((m) => m ?? (r.ok ? "simulado" : null)), () => undefined);
  }, [carregar]);

  const sair = async () => {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
    } catch {
      /* sessão já encerrada */
    }
    fecharCarrinho();
    setSessao({ tipo: "anonimo" });
    window.location.hash = "";
  };

  const demo = modoSap === "simulado";
  const painelBastidores = demo && bastidores && (
    <Bastidores onFechar={() => setBastidores(false)} onMudou={sessao.tipo === "ativa" ? undefined : carregar} />
  );
  const botaoBastidores = demo && (
    <button type="button" className="pt-demo" onClick={() => setBastidores((b) => !b)} aria-pressed={bastidores} title="Bastidores: SAP simulado, UDTs e falhas provocadas">
      <IconBastidores size={14} />
      <span>SAP simulado</span>
    </button>
  );

  if (sessao.tipo !== "ativa") {
    return (
      <div className={bastidores ? "pt-avulsa pt-avulsa--bastidores" : "pt-avulsa"}>
        <div className="pt-avulsa__ferramentas">
          {botaoBastidores}
          <BotaoTema />
        </div>
        <main className="pt-avulsa__conteudo" id="conteudo">
          {sessao.tipo === "carregando" && <Carregando />}
          {sessao.tipo === "anonimo" && <Entrar aviso={sessao.aviso} onEntrou={carregar} />}
          {sessao.tipo === "sem-acesso" && <SemAcesso erro={sessao.erro} onSair={sair} />}
          {sessao.tipo === "indisponivel" && (
            <div className="pt-centro">
              <EmptyState variant="error" title="Portal temporariamente indisponível" description={sessao.mensagem} action={<Button onClick={carregar}>Tentar de novo</Button>} />
            </div>
          )}
        </main>
        {painelBastidores}
      </div>
    );
  }

  return (
    <Shell eu={sessao.eu} onSair={sair} ferramentas={botaoBastidores} lateral={painelBastidores}>
      <Jornada eu={sessao.eu} />
    </Shell>
  );
}

// ---- Shell com menu lateral -----------------------------------------------------------

const CHAVE_RECOLHIDO = "portal.menu.recolhido";

type ItemMenu = { id: string; rotulo: string; href: string; icone: ReactNode; ativo: (r: Rota) => boolean; contador?: number };

const TITULOS: Record<Rota["tela"], [string, string]> = {
  inicio: ["Acompanhar", "Meus pedidos"],
  itens: ["Acompanhar", "Itens e preços"],
  catalogo: ["Comprar", "Catálogo"],
  carrinho: ["Comprar", "Carrinho e entrega"],
  revisao: ["Comprar", "Revisão"],
  protocolo: ["Comprar", "Confirmação"],
};

function Shell({ eu, onSair, ferramentas, lateral, children }: { eu: Eu; onSair: () => void; ferramentas: ReactNode; lateral: ReactNode; children: ReactNode }) {
  const rota = useRota();
  const { linhas } = useCarrinho();
  const [recolhido, setRecolhido] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_RECOLHIDO) === "1";
    } catch {
      return false;
    }
  });
  const [gaveta, setGaveta] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_RECOLHIDO, recolhido ? "1" : "0");
    } catch {
      /* preferência só desta aba */
    }
  }, [recolhido]);

  // Ctrl+B recolhe (atalho de editor); Esc fecha a gaveta no celular.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setRecolhido((v) => !v);
      }
      if (e.key === "Escape") setGaveta(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  // Escolher um item fecha a gaveta: senão ela cobre a tela que acabou de ser pedida.
  useEffect(() => {
    setGaveta(false);
  }, [rota.tela]);

  const grupos: { titulo: string; itens: ItemMenu[] }[] = [
    {
      titulo: "Acompanhar",
      itens: [
        { id: "inicio", rotulo: "Meus pedidos", href: "#/", icone: <IconInbox />, ativo: (r) => r.tela === "inicio" },
        { id: "itens", rotulo: "Itens e preços", href: "#/itens", icone: <IconChart />, ativo: (r) => r.tela === "itens" },
      ],
    },
    {
      titulo: "Comprar",
      itens: [
        { id: "catalogo", rotulo: "Catálogo", href: "#/catalogo", icone: <IconBox />, ativo: (r) => r.tela === "catalogo" },
        {
          id: "carrinho",
          rotulo: "Carrinho",
          href: "#/carrinho",
          icone: <IconCarrinho />,
          ativo: (r) => r.tela === "carrinho" || r.tela === "revisao" || r.tela === "protocolo",
          contador: linhas.length,
        },
      ],
    },
  ];

  const [secao, titulo] = TITULOS[rota.tela];
  const iniciais = eu.user.name.split(" ").map((n) => n[0]).slice(0, 2).join("");

  return (
    <div className={["pt-shell", recolhido ? "pt-shell--recolhido" : "", gaveta ? "pt-shell--gaveta" : "", lateral ? "pt-shell--bastidores" : ""].filter(Boolean).join(" ")}>
      <nav className="pt-menu" aria-label="Navegação principal">
        <div className="pt-menu__topo">
          <a href="#/" className="pt-menu__marca" aria-label={`${NOME_MARCA} — meus pedidos`}>
            <MarcaCliente recolhida={recolhido} />
          </a>
          <button
            type="button"
            className="pt-menu__recolher"
            onClick={() => setRecolhido((v) => !v)}
            aria-label={recolhido ? "Expandir menu (Ctrl+B)" : "Recolher menu (Ctrl+B)"}
            title={recolhido ? "Expandir menu (Ctrl+B)" : "Recolher menu (Ctrl+B)"}
            aria-expanded={!recolhido}
          >
            <IconPanelLeft />
          </button>
        </div>

        <div className="pt-menu__cliente" title={`${eu.customer.name} · cliente ${eu.customer.code}`}>
          <span className="pt-menu__cliente-icone" aria-hidden="true">
            <IconBuilding />
          </span>
          {!recolhido && (
            <span className="pt-menu__cliente-texto">
              <strong>{eu.customer.name}</strong>
              <span className="nh-num">Cliente {eu.customer.code}</span>
            </span>
          )}
        </div>

        <div className="pt-menu__rolagem">
          {grupos.map((g) => (
            <div key={g.titulo} className="pt-menu__grupo">
              {!recolhido && <span className="pt-menu__grupo-titulo">{g.titulo}</span>}
              {g.itens.map((item) => (
                <a
                  key={item.id}
                  href={item.href}
                  className="pt-menu__item"
                  aria-current={item.ativo(rota) ? "page" : undefined}
                  title={recolhido ? item.rotulo : undefined}
                >
                  {item.icone}
                  {!recolhido && <span className="pt-menu__rotulo">{item.rotulo}</span>}
                  {item.contador !== undefined && item.contador > 0 && (
                    <span className={recolhido ? "pt-menu__pip" : "pt-menu__contador nh-num"} aria-label={`${item.contador} itens`}>
                      {recolhido ? "" : item.contador}
                    </span>
                  )}
                </a>
              ))}
            </div>
          ))}
        </div>

        <div className="pt-menu__rodape">
          <div className="pt-menu__usuario" title={eu.user.email}>
            <span className="pt-menu__avatar" aria-hidden="true">
              {iniciais}
            </span>
            {!recolhido && (
              <span className="pt-menu__usuario-texto">
                <strong>{eu.user.name}</strong>
                <span>{eu.user.email}</span>
              </span>
            )}
          </div>
          <button type="button" className="pt-menu__sair" onClick={onSair} aria-label="Sair" title="Sair do portal">
            <IconSair />
          </button>
        </div>
      </nav>

      <button type="button" className="pt-shell__veu" aria-label="Fechar menu" tabIndex={gaveta ? 0 : -1} onClick={() => setGaveta(false)} />

      <div className="pt-area">
        <header className="pt-barra">
          <button type="button" className="pt-barra__menu" onClick={() => setGaveta(true)} aria-label="Abrir menu" aria-expanded={gaveta}>
            <IconPanelLeft />
          </button>
          <span className="pt-barra__trilha">
            <span>{secao}</span>
            <span aria-hidden="true">/</span>
            <strong>{titulo}</strong>
          </span>
          <span className="pt-barra__ferramentas">
            {ferramentas}
            <BotaoTema />
          </span>
        </header>
        <main className="pt-main" id="conteudo">
          {children}
        </main>
      </div>

      {lateral}
    </div>
  );
}

const ROTULO_TEMA: Record<Tema, string> = { sistema: "Tema do sistema", claro: "Tema claro", escuro: "Tema escuro" };

function BotaoTema() {
  const { tema, escuro } = useTema();
  const proximo = proximoTema(tema);
  return (
    <button
      type="button"
      className="pt-tema"
      onClick={() => definirTema(proximo)}
      aria-label={`${ROTULO_TEMA[tema]}. Mudar para ${ROTULO_TEMA[proximo].toLowerCase()}`}
      title={`${ROTULO_TEMA[tema]}${tema === "sistema" ? ` (${escuro ? "escuro" : "claro"})` : ""} — clique para ${ROTULO_TEMA[proximo].toLowerCase()}`}
    >
      {escuro ? <IconLua /> : <IconSol />}
      <span>{tema === "sistema" ? "Auto" : tema === "claro" ? "Claro" : "Escuro"}</span>
    </button>
  );
}

function Jornada({ eu }: { eu: Eu }) {
  const rota = useRota();
  // Tela nova começa do topo; a rolagem da anterior não faz sentido aqui.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [rota.tela]);
  if (rota.tela === "inicio") return <Inicio eu={eu} />;
  if (rota.tela === "itens") return <ItensPrecos />;
  return (
    <>
      <Etapas rota={rota} />
      {rota.tela === "catalogo" && <Catalogo />}
      {rota.tela === "carrinho" && <Carrinho />}
      {rota.tela === "revisao" && <Revisao />}
      {rota.tela === "protocolo" && <Protocolo operationId={rota.operationId} cliente={eu.customer.name} />}
    </>
  );
}

const ETAPAS = [
  { tela: "catalogo", rotulo: "Catálogo" },
  { tela: "carrinho", rotulo: "Carrinho e entrega" },
  { tela: "revisao", rotulo: "Revisão" },
  { tela: "protocolo", rotulo: "Confirmação" },
] as const;

function Etapas({ rota }: { rota: Rota }) {
  const atual = ETAPAS.findIndex((e) => e.tela === rota.tela);
  return (
    <ol className="pt-etapas" aria-label="Etapas do pedido">
      {ETAPAS.map((e, i) => (
        <li key={e.tela} className={i === atual ? "is-atual" : i < atual ? "is-feita" : ""} aria-current={i === atual ? "step" : undefined}>
          <span className="pt-etapas__n nh-num">{i + 1}</span>
          {e.rotulo}
        </li>
      ))}
    </ol>
  );
}

function Carregando() {
  return (
    <div className="pt-centro" aria-busy="true">
      <div style={{ width: 320, display: "grid", gap: 12 }}>
        <Skeleton height="18px" width="60%" />
        <Skeleton height="12px" />
        <Skeleton height="12px" width="80%" />
      </div>
    </div>
  );
}
