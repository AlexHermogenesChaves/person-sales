import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ErroDaApi, type ItemCatalogo } from "../api";
import { brl, dataBr, qtd } from "../formato";
import { comprarDeNovo, type HistoricoItem } from "../historico";
import { Badge, Button, Card, Table, type Column } from "../ui";
import { IconCarrinho, IconSearch } from "../ui/icons";

// Itens que o cliente comprou nos últimos 6 meses e o preço pago em cada compra.
// O preço de hoje vem do catálogo, consultado só quando a pessoa abre o item.

export function ItensPrecos() {
  const [itens, setItens] = useState<HistoricoItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const { dados } = await api<{ items: HistoricoItem[] }>("/api/v1/items/history");
      setItens(dados.items);
    } catch (e) {
      setErro((e as ErroDaApi).message);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (itens ?? []).filter((i) => !termo || i.itemCode.toLowerCase().includes(termo) || i.description.toLowerCase().includes(termo));
  }, [itens, busca]);

  const gasto = (itens ?? []).reduce((s, i) => s + Number(i.total), 0);
  const chave = (i: HistoricoItem) => `${i.itemCode}:${i.uomEntry}`;

  const colunas: Column<HistoricoItem>[] = [
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <div className="pt-produto">
          <span className="pt-produto__nome">{i.description}</span>
          <span className="nh-caption nh-num">{i.itemCode}</span>
        </div>
      ),
    },
    { key: "qtd", header: "Quantidade", numeric: true, align: "right", cell: (i) => `${qtd(i.quantity)} ${i.unit}` },
    { key: "compras", header: "Compras", numeric: true, align: "right", cell: (i) => i.orders },
    {
      key: "ultimo",
      header: "Último preço",
      numeric: true,
      align: "right",
      cell: (i) => (
        <div className="pt-preco">
          <span className="nh-table__cell-strong">{brl(i.lastPrice)}</span>
          <span className="nh-caption">{dataBr(i.lastDate)}</span>
        </div>
      ),
    },
    { key: "medio", header: "Preço médio", numeric: true, align: "right", cell: (i) => brl(i.averagePrice) },
    { key: "faixa", header: "Menor – maior", numeric: true, align: "right", cell: (i) => `${brl(i.minPrice)} – ${brl(i.maxPrice)}` },
    { key: "total", header: "Total gasto", numeric: true, align: "right", cell: (i) => <span className="nh-table__cell-strong">{brl(i.total)}</span> },
  ];

  return (
    <div className="pt-inicio">
      <header className="pt-cabecalho">
        <div>
          <h1>Itens e preços</h1>
          <p className="nh-caption">
            {itens
              ? `${itens.length} itens comprados nos últimos 6 meses · ${brl(String(gasto))} gastos · clique no item para ver o preço pago em cada compra`
              : "Carregando o histórico do SAP…"}
          </p>
        </div>
        <label className="pt-busca">
          <IconSearch />
          <input type="search" placeholder="Código ou parte da descrição" aria-label="Buscar item" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
      </header>
      <Card flush>
        <Table
          columns={colunas}
          rows={visiveis}
          rowKey={chave}
          loading={!itens && !erro}
          error={erro ? { message: erro, onRetry: carregar } : null}
          dense
          onRowClick={(i) => setAberto((a) => (a === chave(i) ? null : chave(i)))}
          empty={{ title: busca ? `Nenhum item com “${busca}”` : "Nenhuma compra nos últimos 6 meses" }}
          renderDetalhe={(i) => (aberto === chave(i) ? <DetalheItem item={i} /> : null)}
        />
      </Card>
    </div>
  );
}

function DetalheItem({ item }: { item: HistoricoItem }) {
  const [hoje, setHoje] = useState<{ preco: string | null; liberado: boolean; porFaixa: boolean } | null>(null);
  const [comprando, setComprando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const mediaPorCompra = Math.max(1, Math.round(Number(item.quantity) / Math.max(1, item.orders)));

  useEffect(() => {
    api<{ items: ItemCatalogo[] }>(`/api/v1/catalog?search=${encodeURIComponent(item.itemCode)}&pageSize=5`)
      .then(({ dados }) => {
        const doCatalogo = dados.items.find((x) => x.itemCode === item.itemCode);
        const unidade = doCatalogo?.units.find((u) => u.entry === item.uomEntry);
        setHoje({ preco: unidade?.referenceUnitPrice ?? null, liberado: Boolean(unidade), porFaixa: Boolean(doCatalogo?.priceRequiresReview) });
      })
      .catch(() => setHoje({ preco: null, liberado: false, porFaixa: false }));
  }, [item.itemCode, item.uomEntry]);

  // Com faixa por quantidade, o preço do catálogo (1 unidade) e o último pago (na
  // quantidade daquela compra) são de faixas diferentes: comparar seria enganoso.
  const variacao = hoje?.preco && !hoje.porFaixa ? (Number(hoje.preco) - Number(item.lastPrice)) / Number(item.lastPrice) : null;

  const comprar = async () => {
    setComprando(true);
    try {
      const { fora } = await comprarDeNovo([{ itemCode: item.itemCode, uomEntry: item.uomEntry, quantity: String(mediaPorCompra) }]);
      if (fora.length) setAviso("Este item não está liberado no catálogo hoje.");
    } finally {
      setComprando(false);
    }
  };

  return (
    <div className="pt-detalhe pt-historico">
      <div className="pt-historico__grafico">
        <GraficoPreco item={item} />
      </div>
      <div className="pt-historico__lado">
        <dl className="pt-totais">
          <div>
            <dt>Último preço pago</dt>
            <dd className="nh-num">{brl(item.lastPrice)}</dd>
          </div>
          <div>
            <dt>Preço de hoje no catálogo</dt>
            <dd className="nh-num">
              {!hoje ? "…" : hoje.preco ? brl(hoje.preco) : "indisponível"}
              {variacao !== null && Math.abs(variacao) >= 0.001 && (
                <Badge tone={variacao > 0 ? "warn" : "ok"}>
                  {variacao > 0 ? "+" : ""}
                  {(variacao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                </Badge>
              )}
            </dd>
          </div>
          <div>
            <dt>Compra média</dt>
            <dd className="nh-num">
              {qtd(String(mediaPorCompra))} {item.unit}
            </dd>
          </div>
        </dl>
        <p className="nh-caption">
          {hoje?.porFaixa
            ? `Este item tem preço por faixa de quantidade: o catálogo mostra o preço de 1 ${item.unit}, e o valor para ${qtd(String(mediaPorCompra))} ${item.unit} sai na revisão.`
            : "Preço de hoje é referência; o valor final sai na revisão do pedido."}
        </p>
        {aviso && <p className="pt-aviso pt-aviso--warn">{aviso}</p>}
        <Button variant="primary" icon={<IconCarrinho size={14} />} onClick={comprar} loading={comprando} disabled={hoje !== null && !hoje.liberado}>
          Comprar {qtd(String(mediaPorCompra))} {item.unit}
        </Button>
      </div>
    </div>
  );
}

/** Linha do preço pago por compra, com a faixa menor–maior. SVG à mão, sem biblioteca. */
function GraficoPreco({ item }: { item: HistoricoItem }) {
  // viewBox perto da largura real do painel: o texto do eixo não escala demais.
  const L = 900;
  const A = 200;
  const m = { e: 72, d: 16, t: 14, b: 28 };
  const precos = item.points.map((p) => Number(p.price));
  const min = Math.min(...precos);
  const max = Math.max(...precos);
  const folga = (max - min || max * 0.05) * 0.25;
  const y0 = min - folga;
  const y1 = max + folga;
  const tempos = item.points.map((p) => new Date(`${p.date}T12:00:00Z`).getTime());
  const t0 = Math.min(...tempos);
  const t1 = Math.max(...tempos, t0 + 1);
  const x = (t: number) => m.e + ((t - t0) / (t1 - t0)) * (L - m.e - m.d);
  const y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0)) * (A - m.t - m.b);
  const caminho = item.points.map((p, i) => `${i ? "L" : "M"}${x(tempos[i]).toFixed(1)},${y(Number(p.price)).toFixed(1)}`).join(" ");

  return (
    <figure className="pt-grafico-preco">
      <figcaption className="nh-caption">Preço pago por {item.unit} em cada compra ({item.points.length})</figcaption>
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label={`Preço de ${item.itemCode} entre ${brl(item.minPrice)} e ${brl(item.maxPrice)}`}>
        {[min, max].map((v) => (
          <g key={v}>
            <line x1={m.e} x2={L - m.d} y1={y(v)} y2={y(v)} className="pt-grafico-preco__guia" />
            <text x={m.e - 6} y={y(v) + 4} textAnchor="end" className="pt-grafico-preco__eixo">
              {brl(String(v))}
            </text>
          </g>
        ))}
        <path d={caminho} className="pt-grafico-preco__linha" />
        {item.points.map((p, i) => (
          <circle key={`${p.docNum}-${i}`} cx={x(tempos[i])} cy={y(Number(p.price))} r={i === item.points.length - 1 ? 4 : 2.5} className={i === item.points.length - 1 ? "pt-grafico-preco__ponto is-ultimo" : "pt-grafico-preco__ponto"}>
            <title>{`${dataBr(p.date)} · pedido ${p.docNum} · ${qtd(p.quantity)} ${item.unit} a ${brl(p.price)}`}</title>
          </circle>
        ))}
        <text x={m.e} y={A - 6} className="pt-grafico-preco__eixo">
          {dataBr(item.points[0].date)}
        </text>
        <text x={L - m.d} y={A - 6} textAnchor="end" className="pt-grafico-preco__eixo">
          {dataBr(item.points.at(-1)!.date)}
        </text>
      </svg>
    </figure>
  );
}
