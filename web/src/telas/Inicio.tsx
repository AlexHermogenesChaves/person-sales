import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ErroDaApi, type Eu } from "../api";
import { brl, dataBr } from "../formato";
import { emAberto, ORIGEM, previsaoVencida, SITUACAO, type Pedido } from "../historico";
import { ir } from "../rotas";
import { Badge, Button, Card, EmptyState, Skeleton, Table, type Column } from "../ui";
import { IconAlerta, IconAtualizar, IconCarrinho, IconRelogio, IconSearch } from "../ui/icons";
import { AvisoPendente } from "./AvisoPendente";
import { PainelPedido } from "./PainelPedido";

// Página inicial do comprador. Tudo vem do SAP na hora: pedidos do cliente de
// qualquer origem (portal, vendedor, EDI) dos últimos seis meses e os indicadores
// calculados sobre essa mesma leitura. A situação é medida pelo faturamento.

type Resumo = {
  asOf: string;
  open: { orders: number; total: string; pending: string };
  attention: {
    awaitingApproval: { orders: number; total: string };
    overdue: { orders: number; pending: string; oldest: string | null };
    partial: { orders: number; pending: string };
    uncertainSubmissions: { operationId: string; createdAt: string }[];
  };
  nextDelivery: { date: string; docNum: number; orders: number } | null;
  monthToDate: { total: string; orders: number; previousSamePeriod: string };
  averageTicket90d: string;
  monthly: { month: string; total: string; orders: number }[];
  origins: { PORTAL: number; VENDEDOR: number; EDI: number };
};

type Filtro = { chave: string; rotulo: string; aceita: (p: Pedido, hoje: string) => boolean };

const FILTROS: Filtro[] = [
  { chave: "todos", rotulo: "Todos", aceita: () => true },
  { chave: "abertos", rotulo: "Em aberto", aceita: (p) => emAberto(p) },
  { chave: "aprovacao", rotulo: "Aguardando aprovação", aceita: (p) => p.status === "AGUARDANDO_APROVACAO" },
  { chave: "aprovados", rotulo: "Aprovados", aceita: (p) => p.status === "APROVADO" },
  { chave: "parciais", rotulo: "Parcialmente faturados", aceita: (p) => p.status === "PARCIAL" },
  { chave: "faturados", rotulo: "Faturados", aceita: (p) => p.status === "FATURADO" },
  { chave: "vencidos", rotulo: "Previsão vencida", aceita: (p, hoje) => previsaoVencida(p, hoje) },
  { chave: "portal", rotulo: "Feitos no portal", aceita: (p) => p.origin === "PORTAL" },
];

export function Inicio({ eu }: { eu: Eu }) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<Pedido | null>(null);
  const [limite, setLimite] = useState(15);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [r, p] = await Promise.all([api<Resumo>("/api/v1/summary"), api<{ orders: Pedido[] }>("/api/v1/orders")]);
      setResumo(r.dados);
      setPedidos(p.dados.orders);
    } catch (e) {
      setErro((e as ErroDaApi).message);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const hoje = resumo?.asOf ?? new Date().toISOString().slice(0, 10);

  const visiveis = useMemo(() => {
    const f = FILTROS.find((x) => x.chave === filtro)!;
    const termo = busca.trim().toLowerCase();
    return (pedidos ?? [])
      .filter((p) => f.aceita(p, hoje))
      .filter(
        (p) =>
          !termo ||
          String(p.docNum).includes(termo) ||
          p.customerReference.toLowerCase().includes(termo) ||
          p.lines.some((l) => l.itemCode.toLowerCase().includes(termo) || l.description.toLowerCase().includes(termo)),
      );
  }, [pedidos, filtro, busca, hoje]);

  const totais = useMemo(() => {
    const ativos = visiveis.filter((p) => p.status !== "CANCELADO");
    const s = (campo: "total" | "invoiced" | "pending") => ativos.reduce((acc, p) => acc + Math.round(Number(p[campo]) * 100), 0) / 100;
    return { total: s("total"), faturado: s("invoiced"), falta: s("pending") };
  }, [visiveis]);

  const filtrar = (chave: string) => {
    setFiltro(chave);
    setLimite(15);
    document.getElementById("seus-pedidos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const colunas: Column<Pedido>[] = [
    {
      key: "num",
      header: "Pedido",
      cell: (p) => (
        <div className="pt-produto">
          <span className="pt-produto__nome nh-num">{p.type === "DRAFT" ? `Rascunho ${p.docNum}` : p.docNum}</span>
          {p.customerReference && <span className="nh-caption">{p.customerReference}</span>}
        </div>
      ),
    },
    { key: "data", header: "Emissão", numeric: true, cell: (p) => dataBr(p.date) },
    { key: "origem", header: "Origem", cell: (p) => <span className={p.origin === "PORTAL" ? "pt-origem pt-origem--portal" : "pt-origem"}>{ORIGEM[p.origin]}</span> },
    {
      key: "sit",
      header: "Situação",
      cell: (p) => (
        <Badge tone={SITUACAO[p.status].tom} dot>
          {SITUACAO[p.status].rotulo}
        </Badge>
      ),
    },
    { key: "itens", header: "Itens", numeric: true, align: "right", cell: (p) => p.lines.length },
    { key: "total", header: "Total", numeric: true, align: "right", cell: (p) => <span className="nh-table__cell-strong">{brl(p.total)}</span> },
    { key: "fat", header: "Faturado", numeric: true, align: "right", cell: (p) => (Number(p.invoiced) > 0 ? brl(p.invoiced) : <span className="nh-muted">{brl("0")}</span>) },
    {
      key: "falta",
      header: "Falta chegar",
      numeric: true,
      align: "right",
      width: "170px",
      cell: (p) =>
        Number(p.pending) > 0 && p.status !== "CANCELADO" ? (
          <div className="pt-falta">
            {p.status === "PARCIAL" && (
              <span className="pt-falta__barra" aria-hidden="true" title={`${Math.round((Number(p.invoiced) / Number(p.total)) * 100)}% faturado`}>
                <span style={{ width: `${Math.min(100, (Number(p.invoiced) / Number(p.total)) * 100)}%` }} />
              </span>
            )}
            <span>{brl(p.pending)}</span>
          </div>
        ) : (
          <span className="nh-muted">—</span>
        ),
    },
    {
      key: "prev",
      header: "Previsão",
      numeric: true,
      cell: (p) =>
        !emAberto(p) && p.status !== "AGUARDANDO_APROVACAO" ? (
          <span className="nh-muted">—</span>
        ) : p.status === "AGUARDANDO_APROVACAO" ? (
          <span className="nh-muted">após aprovação</span>
        ) : (
          <span className={previsaoVencida(p, hoje) ? "pt-texto-perigo" : undefined} title={previsaoVencida(p, hoje) ? "Previsão vencida com itens a faturar" : undefined}>
            {dataBr(p.expectedDate)}
          </span>
        ),
    },
  ];

  if (erro) {
    return (
      <Card>
        <EmptyState variant="error" title="Não foi possível carregar seus pedidos" description={erro} action={<Button onClick={carregar}>Tentar de novo</Button>} />
      </Card>
    );
  }

  return (
    <div className="pt-inicio">
      <header className="pt-cabecalho">
        <div>
          <h1>Olá, {eu.user.name.split(" ")[0]}</h1>
          <p className="nh-caption">
            {eu.customer.name} · situação no SAP em {resumo ? dataBr(resumo.asOf) : "…"}
          </p>
        </div>
        <div className="nh-acoes">
          <Button variant="ghost" icon={<IconAtualizar size={14} />} onClick={carregar}>
            Atualizar
          </Button>
          <Button variant="primary" icon={<IconCarrinho size={14} />} onClick={() => ir({ tela: "catalogo" })}>
            Fazer pedido
          </Button>
        </div>
      </header>

      <AvisoPendente />

      <div className="pt-kpis">
        {!resumo ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="pt-kpi">
              <Skeleton height="12px" width="50%" />
              <Skeleton height="22px" width="70%" />
              <Skeleton height="10px" width="80%" />
            </div>
          ))
        ) : (
          <>
            <Kpi
              rotulo="Falta chegar"
              valor={brl(resumo.open.pending)}
              detalhe={`${resumo.open.orders} ${resumo.open.orders === 1 ? "pedido aberto" : "pedidos abertos"} no SAP`}
              onClick={() => filtrar("abertos")}
            />
            <Kpi
              rotulo="Próxima previsão"
              valor={resumo.nextDelivery ? diaSemana(resumo.nextDelivery.date) : "Nenhuma"}
              detalhe={
                resumo.nextDelivery
                  ? `Pedido ${resumo.nextDelivery.docNum}${resumo.nextDelivery.orders > 1 ? ` e mais ${resumo.nextDelivery.orders - 1}` : ""}`
                  : "Sem pedido aberto com previsão futura"
              }
            />
            <Kpi
              rotulo={`Comprado em ${nomeMes(resumo.asOf, "long")}`}
              valor={brl(resumo.monthToDate.total)}
              detalhe={comparacao(resumo)}
              tom={variacao(resumo) === null ? undefined : variacao(resumo)! >= 0 ? "ok" : "warn"}
            />
            <Kpi rotulo="Ticket médio" valor={brl(resumo.averageTicket90d)} detalhe="Por pedido, nos últimos 90 dias" />
          </>
        )}
      </div>

      <div className="pt-paineis">
        <Card title="Compras por mês" description="Valor dos pedidos não cancelados, por mês de emissão">
          {resumo ? <GraficoMeses meses={resumo.monthly} /> : <Skeleton height="160px" />}
          {resumo && (
            <p className="nh-caption pt-origens">
              Origem nos 6 meses: {resumo.origins.VENDEDOR} pelo vendedor · {resumo.origins.EDI} por EDI · <strong>{resumo.origins.PORTAL} pelo portal</strong> ·{" "}
              <a href="#/itens">ver itens e preços</a>
            </p>
          )}
        </Card>

        <Card title="Precisa da sua atenção" description={`Hoje, ${dataBr(hoje)} · não depende do filtro da lista`}>
          {!resumo ? <Skeleton height="160px" /> : <Atencao resumo={resumo} onFiltrar={filtrar} />}
        </Card>
      </div>

      <Card
        title={<span id="seus-pedidos">Seus pedidos</span>}
        description="Pedidos da sua empresa no SAP nos últimos 6 meses — do portal, do vendedor e de EDI. Clique na linha para ver o andamento."
        actions={
          <label className="pt-busca">
            <IconSearch />
            <input type="search" placeholder="Nº, OC ou item" aria-label="Buscar pedidos" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
        }
        flush
      >
        <div className="pt-chips" role="tablist" aria-label="Filtrar pedidos">
          {FILTROS.map((f) => (
            <button key={f.chave} type="button" role="tab" aria-selected={filtro === f.chave} className={filtro === f.chave ? "pt-chip is-ativo" : "pt-chip"} onClick={() => filtrar(f.chave)}>
              {f.rotulo} <span className="nh-num">{(pedidos ?? []).filter((p) => f.aceita(p, hoje)).length}</span>
            </button>
          ))}
        </div>
        <Table
          columns={colunas}
          rows={visiveis.slice(0, limite)}
          rowKey={(p) => `${p.type}-${p.docEntry}`}
          loading={!pedidos}
          dense
          onRowClick={setAberto}
          empty={{ title: busca ? `Nenhum pedido com “${busca}”` : "Nenhum pedido neste filtro", description: "A lista mostra os últimos 6 meses." }}
        />
        {pedidos && visiveis.length > 0 && (
          <div className="pt-totais-lista nh-num">
            <span>
              {visiveis.length} {visiveis.length === 1 ? "pedido" : "pedidos"} · mostrando {Math.min(limite, visiveis.length)}
            </span>
            <span>
              Total <strong>{brl(String(totais.total))}</strong>
            </span>
            <span>
              Faturado <strong>{brl(String(totais.faturado))}</strong>
            </span>
            <span>
              Falta chegar <strong>{brl(String(totais.falta))}</strong>
            </span>
          </div>
        )}
        {visiveis.length > limite && (
          <div className="pt-mais">
            <Button onClick={() => setLimite((l) => l + 15)}>Mostrar mais {Math.min(15, visiveis.length - limite)}</Button>
          </div>
        )}
      </Card>

      {aberto && <PainelPedido pedido={aberto} hoje={hoje} onFechar={() => setAberto(null)} />}
    </div>
  );
}

function Atencao({ resumo, onFiltrar }: { resumo: Resumo; onFiltrar: (f: string) => void }) {
  const a = resumo.attention;
  const itens: { chave: string; tom: "danger" | "warn" | "info"; icone: ReactNode; valor: string; texto: string; acao: () => void }[] = [];
  for (const e of a.uncertainSubmissions) {
    itens.push({
      chave: e.operationId,
      tom: "danger",
      icone: <IconAlerta />,
      valor: `Protocolo ${e.operationId.slice(0, 8)}`,
      texto: `envio de ${dataBr(e.createdAt)} sem confirmação do SAP · não envie de novo, consulte`,
      acao: () => ir({ tela: "protocolo", operationId: e.operationId }),
    });
  }
  if (a.overdue.orders) {
    itens.push({
      chave: "vencidos",
      tom: "warn",
      icone: <IconRelogio />,
      valor: brl(a.overdue.pending),
      texto: `${a.overdue.orders} ${a.overdue.orders === 1 ? "pedido com previsão vencida" : "pedidos com previsão vencida"}${a.overdue.oldest ? ` · desde ${dataBr(a.overdue.oldest)}` : ""}`,
      acao: () => onFiltrar("vencidos"),
    });
  }
  if (a.awaitingApproval.orders) {
    itens.push({
      chave: "aprovacao",
      tom: "warn",
      icone: <IconRelogio />,
      valor: brl(a.awaitingApproval.total),
      texto: `${a.awaitingApproval.orders} ${a.awaitingApproval.orders === 1 ? "pedido aguardando" : "pedidos aguardando"} aprovação comercial`,
      acao: () => onFiltrar("aprovacao"),
    });
  }
  if (a.partial.orders) {
    itens.push({
      chave: "parciais",
      tom: "info",
      icone: <IconCarrinho />,
      valor: brl(a.partial.pending),
      texto: `falta chegar de ${a.partial.orders} ${a.partial.orders === 1 ? "pedido parcialmente faturado" : "pedidos parcialmente faturados"}`,
      acao: () => onFiltrar("parciais"),
    });
  }
  if (!itens.length) return <p className="nh-caption">Nada pendente hoje. Todos os envios estão confirmados e nenhuma previsão venceu.</p>;
  return (
    <ul className="pt-atencao">
      {itens.map((i) => (
        <li key={i.chave}>
          <button type="button" className={`pt-atencao__item pt-atencao__item--${i.tom}`} onClick={i.acao}>
            <span className="pt-atencao__icone" aria-hidden="true">
              {i.icone}
            </span>
            <span className="pt-atencao__texto">
              <strong className="nh-num">{i.valor}</strong>
              <span>{i.texto}</span>
            </span>
            <span aria-hidden="true" className="pt-atencao__seta">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Kpi({ rotulo, valor, detalhe, tom, onClick }: { rotulo: string; valor: string; detalhe: string; tom?: "ok" | "warn"; onClick?: () => void }) {
  const conteudo = (
    <>
      <span className="pt-kpi__rotulo">{rotulo}</span>
      <span className="pt-kpi__valor nh-num">{valor}</span>
      <span className={tom ? `pt-kpi__detalhe pt-kpi__detalhe--${tom}` : "pt-kpi__detalhe"}>{detalhe}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="pt-kpi pt-kpi--clicavel" onClick={onClick}>
      {conteudo}
    </button>
  ) : (
    <div className="pt-kpi">{conteudo}</div>
  );
}

/** Barras em HTML: rótulo e valor legíveis em cada mês, sem biblioteca de gráfico. */
function GraficoMeses({ meses }: { meses: Resumo["monthly"] }) {
  const max = Math.max(...meses.map((m) => Number(m.total)), 1);
  return (
    <div className="pt-meses" role="img" aria-label={meses.map((m) => `${nomeMes(m.month)}: ${brl(m.total)}`).join("; ")}>
      {meses.map((m, i) => (
        <div key={m.month} className="pt-meses__coluna">
          <span className="pt-meses__valor nh-num">{compacto(Number(m.total))}</span>
          <div className="pt-meses__trilho">
            <span className={i === meses.length - 1 ? "pt-meses__barra is-atual" : "pt-meses__barra"} style={{ height: `${(Number(m.total) / max) * 100}%` }} title={`${brl(m.total)} em ${m.orders} pedidos`} />
          </div>
          <span className="pt-meses__mes">{nomeMes(m.month)}</span>
          <span className="nh-caption nh-num">{m.orders} ped.</span>
        </div>
      ))}
    </div>
  );
}

const nomeMes = (iso: string, forma: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("pt-BR", { month: forma, timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-15T12:00:00Z`)).replace(".", "");

const diaSemana = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)).replace(".", "");

const compacto = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }));

function variacao(r: Resumo) {
  const antes = Number(r.monthToDate.previousSamePeriod);
  return antes > 0 ? (Number(r.monthToDate.total) - antes) / antes : null;
}

function comparacao(r: Resumo) {
  const v = variacao(r);
  const mesAnterior = nomeMes(new Date(Date.UTC(Number(r.asOf.slice(0, 4)), Number(r.asOf.slice(5, 7)) - 2, 15)).toISOString(), "long");
  if (v === null) return `${r.monthToDate.orders} pedidos no mês`;
  const pct = `${v >= 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
  return `${pct} sobre o mesmo período de ${mesAnterior}`;
}
