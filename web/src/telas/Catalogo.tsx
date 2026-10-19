import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErroDaApi, type ItemCatalogo, type Unidade } from "../api";
import { adicionar, useCarrinho } from "../estado";
import { brl, normalizarQuantidade, qtd, somaReferencia } from "../formato";
import { ir } from "../rotas";
import { Badge, Button, Card, Table, type Column } from "../ui";
import { IconCarrinho, IconCheck, IconSearch } from "../ui/icons";
import { FotoProduto } from "../ui/FotoProduto";
import { AvisoPendente } from "./AvisoPendente";

type Pagina = { items: ItemCatalogo[]; nextCursor: string | null };
type Escolha = { uomEntry: number; quantidade: string };

export function Catalogo() {
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState<ItemCatalogo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [adicionado, setAdicionado] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const pedido = useRef(0);

  const consultar = useCallback(async (termo: string, depoisDe: string | null) => {
    const n = ++pedido.current;
    const params = new URLSearchParams({ pageSize: "20" });
    if (termo.trim()) params.set("search", termo.trim());
    if (depoisDe) params.set("cursor", depoisDe);
    const { dados } = await api<Pagina>(`/api/v1/catalog?${params}`);
    return n === pedido.current ? dados : null;
  }, []);

  useEffect(() => {
    setCarregando(true);
    setErro(null);
    const t = setTimeout(() => {
      consultar(busca, null)
        .then((d) => {
          if (!d) return;
          setItens(d.items);
          setCursor(d.nextCursor);
          setCarregando(false);
        })
        .catch((e: ErroDaApi) => {
          setErro(e.message);
          setCarregando(false);
        });
    }, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [busca, consultar, tentativa]);

  const maisItens = async () => {
    setCarregandoMais(true);
    try {
      const d = await consultar(busca, cursor);
      if (d) {
        setItens((atual) => [...atual, ...d.items]);
        setCursor(d.nextCursor);
      }
    } catch (e) {
      setErro((e as ErroDaApi).message);
    } finally {
      setCarregandoMais(false);
    }
  };

  const escolhaDe = (i: ItemCatalogo): Escolha => escolhas[i.itemCode] ?? { uomEntry: i.units[0].entry, quantidade: qtd(i.units[0].multiple) };
  const unidadeDe = (i: ItemCatalogo) => i.units.find((u) => u.entry === escolhaDe(i).uomEntry) ?? i.units[0];
  const mudar = (i: ItemCatalogo, parcial: Partial<Escolha>) => setEscolhas((e) => ({ ...e, [i.itemCode]: { ...escolhaDe(i), ...parcial } }));

  const incluir = (i: ItemCatalogo) => {
    const u = unidadeDe(i);
    const quantidade = normalizarQuantidade(escolhaDe(i).quantidade);
    if (!quantidade || !multiploOk(quantidade, u.multiple)) return;
    adicionar({
      itemCode: i.itemCode,
      description: i.description,
      uomEntry: u.entry,
      unit: u.label,
      multiple: u.multiple,
      quantity: quantidade,
      refPrice: u.referenceUnitPrice,
      imagem: i.imageUrl,
    });
    setAdicionado(i.itemCode);
    setTimeout(() => setAdicionado((a) => (a === i.itemCode ? null : a)), 1400);
  };

  const colunas: Column<ItemCatalogo>[] = [
    {
      key: "produto",
      header: "Produto",
      cell: (i) => (
        <div className="pt-produto pt-produto--com-icone">
          <FotoProduto src={i.imageUrl} unidade={unidadeDe(i).label} alt={i.description} grande />
          <span className="pt-produto__textos">
            <span className="pt-produto__nome">{i.description}</span>
            <span className="nh-caption nh-num">
              {i.itemCode} · {i.group}
            </span>
            {i.availability === "ON_REQUEST" && (
              <Badge tone="warn" dot title="Sem saldo confirmado agora. A fábrica confirma o atendimento depois do pedido.">
                Sob consulta
              </Badge>
            )}
          </span>
        </div>
      ),
    },
    {
      key: "unidade",
      header: "Unidade",
      width: "120px",
      cell: (i) =>
        i.units.length === 1 ? (
          <span title={i.units[0].description}>{rotuloUnidade(i.units[0])}</span>
        ) : (
          <select
            className="nh-field__control pt-select-curto"
            aria-label={`Unidade de ${i.itemCode}`}
            value={escolhaDe(i).uomEntry}
            onChange={(e) => {
              const u = i.units.find((x) => x.entry === Number(e.target.value))!;
              mudar(i, { uomEntry: u.entry, quantidade: qtd(u.multiple) });
            }}
          >
            {i.units.map((u) => (
              <option key={u.entry} value={u.entry}>
                {rotuloUnidade(u)}
              </option>
            ))}
          </select>
        ),
    },
    {
      key: "preco",
      header: "Preço",
      align: "right",
      numeric: true,
      width: "140px",
      cell: (i) => {
        const u = unidadeDe(i);
        return (
          <div className="pt-preco">
            <span className="nh-table__cell-strong">{brl(u.referenceUnitPrice)}</span>
            {u.priceOrigin === "ESPECIAL" && <Badge tone="ok">Preço do seu contrato</Badge>}
            {i.priceRequiresReview && (
              <span className="nh-caption" title="O SAP aplica preço menor a partir de uma quantidade; o valor final sai na revisão.">
                varia com a quantidade
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "qtd",
      header: "Quantidade",
      width: "170px",
      cell: (i) => {
        const u = unidadeDe(i);
        const texto = escolhaDe(i).quantidade;
        const q = normalizarQuantidade(texto);
        const invalida = !q || !multiploOk(q, u.multiple);
        return (
          <div className="pt-incluir">
            <input
              className="nh-field__control pt-qtd nh-num"
              inputMode="decimal"
              aria-label={`Quantidade de ${i.itemCode} em ${u.label}`}
              aria-invalid={invalida || undefined}
              value={texto}
              onChange={(e) => mudar(i, { quantidade: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && incluir(i)}
            />
            <Button
              size="sm"
              variant={adicionado === i.itemCode ? "secondary" : "primary"}
              onClick={() => incluir(i)}
              disabled={invalida}
              title={invalida ? `Vendido em múltiplos de ${qtd(u.multiple)} ${u.label}` : undefined}
              icon={adicionado === i.itemCode ? <IconCheck size={14} /> : undefined}
            >
              {adicionado === i.itemCode ? "Incluído" : "Incluir"}
            </Button>
            {u.multiple !== "1" && <span className="nh-caption">múlt. {qtd(u.multiple)}</span>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="pt-grade">
      <div className="pt-grade__principal">
        <AvisoPendente />
        <Card
          title="Catálogo"
          description="Itens liberados para a sua empresa, com o preço da sua condição comercial no SAP."
          actions={
            <label className="pt-busca">
              <IconSearch />
              <input
                type="search"
                placeholder="Código ou descrição"
                aria-label="Buscar no catálogo"
                maxLength={60}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
          }
          flush
        >
          <div className="pt-chips" role="group" aria-label="Filtrar por marca">
            {["", "Reali Junior", "Pita Bread", "Cabocla Mineira", "Tá Pronto"].map((marca) => (
              <button
                key={marca || "todas"}
                type="button"
                aria-pressed={busca === marca}
                className={busca === marca ? "pt-chip is-ativo" : "pt-chip"}
                onClick={() => setBusca(marca)}
              >
                {marca || "Todas as marcas"}
              </button>
            ))}
          </div>
          <Table
            columns={colunas}
            rows={itens}
            rowKey={(i) => i.itemCode}
            loading={carregando}
            error={erro ? { message: erro, onRetry: () => setTentativa((n) => n + 1) } : null}
            empty={{
              title: busca ? `Nenhum item encontrado para “${busca}”` : "Nenhum item liberado no portal",
              description: busca ? "Tente parte da descrição (ex.: forma, bisnaguinha) ou o código do item." : "A publicação de itens é feita pela equipe comercial no SAP.",
            }}
          />
          {cursor && !carregando && (
            <div className="pt-mais">
              <Button onClick={maisItens} loading={carregandoMais}>
                Mostrar mais itens
              </Button>
            </div>
          )}
        </Card>
      </div>
      <ResumoCarrinho />
    </div>
  );
}

function ResumoCarrinho() {
  const { linhas } = useCarrinho();
  const referencia = somaReferencia(linhas);
  return (
    <aside className="pt-grade__lateral">
      <Card title="Seu pedido" description={linhas.length ? `${linhas.length} ${linhas.length === 1 ? "item" : "itens"}` : undefined}>
        {linhas.length === 0 ? (
          <p className="nh-caption">Inclua itens do catálogo. O carrinho fica guardado nesta aba do navegador.</p>
        ) : (
          <>
            <ul className="pt-resumo">
              {linhas.slice(-6).map((l) => (
                <li key={`${l.itemCode}:${l.uomEntry}`}>
                  <span className="pt-resumo__nome">{l.description}</span>
                  <span className="nh-num nh-caption">
                    {qtd(l.quantity)} {l.unit}
                  </span>
                </li>
              ))}
            </ul>
            {linhas.length > 6 && <p className="nh-caption">+ {linhas.length - 6} no carrinho</p>}
            <div className="pt-resumo__total">
              <span>Subtotal de referência</span>
              <strong className="nh-num">{brl(referencia)}</strong>
            </div>
            <p className="nh-caption">Impostos, frete e preço final são calculados pelo SAP na revisão.</p>
            <Button variant="primary" className="pt-largo" icon={<IconCarrinho size={14} />} onClick={() => ir({ tela: "carrinho" })}>
              Ir para o carrinho
            </Button>
          </>
        )}
      </Card>
    </aside>
  );
}

const rotuloUnidade = (u: Unidade) => u.description;

/** Múltiplo de venda conferido em inteiro (milésimos), sem float. */
export function multiploOk(quantidade: string, multiplo: string) {
  const mil = (s: string) => {
    const [i, f = ""] = s.split(".");
    return BigInt(i) * 1000n + BigInt(f.padEnd(3, "0").slice(0, 3));
  };
  const m = mil(multiplo);
  return m > 0n && mil(quantidade) % m === 0n;
}
