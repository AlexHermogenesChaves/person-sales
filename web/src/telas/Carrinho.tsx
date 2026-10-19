import { useEffect, useState } from "react";
import { api, ErroDaApi, type Endereco, type Revisao } from "../api";
import { alterarEntrega, alterarQuantidade, guardarRevisao, remover, useCarrinho, type LinhaCarrinho } from "../estado";
import { brl, dataLocal, normalizarQuantidade, qtd, somaReferencia } from "../formato";
import { ir } from "../rotas";
import { Button, Card, EmptyState, Input, Select, Skeleton, Table, Textarea, type Column } from "../ui";
import { IconLixo, IconVoltar } from "../ui/icons";
import { FotoProduto } from "../ui/FotoProduto";
import { Quantidade, useEstreito } from "../ui/Quantidade";
import { AvisoPendente } from "./AvisoPendente";
import { multiploOk } from "./Catalogo";

const MAX_OBS = 500;

export function Carrinho() {
  const { linhas, entrega, pendente } = useCarrinho();
  const [enderecos, setEnderecos] = useState<Endereco[] | null>(null);
  const [erroEnderecos, setErroEnderecos] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<ErroDaApi | null>(null);
  const [revisando, setRevisando] = useState(false);
  const estreito = useEstreito();
  const [avisoRepetir] = useState(() => {
    try {
      const aviso = sessionStorage.getItem("portal:aviso-repetir");
      sessionStorage.removeItem("portal:aviso-repetir");
      return aviso;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    api<{ addresses: Endereco[] }>("/api/v1/addresses")
      .then(({ dados }) => {
        setEnderecos(dados.addresses);
        if (!dados.addresses.some((a) => a.code === entrega.shipToCode) && dados.addresses[0]) {
          alterarEntrega({ shipToCode: dados.addresses[0].code });
        }
      })
      .catch((e: ErroDaApi) => setErroEnderecos(e.message));
  }, []); // lido uma vez por tela; a escolha do endereço mora no estado do carrinho

  useEffect(() => {
    if (!entrega.requestedDate || entrega.requestedDate < dataLocal(1)) alterarEntrega({ requestedDate: dataLocal(2) });
  }, [entrega.requestedDate]);

  const erroDoCampo = (campo: string) => erro?.fieldErrors.find((f) => f.campo === campo)?.mensagem;
  const erroDaLinha = (i: number) => erro?.fieldErrors.find((f) => f.campo.startsWith(`items[${i}]`))?.mensagem;

  const revisar = async () => {
    setErro(null);
    setRevisando(true);
    try {
      const { dados } = await api<Revisao>("/api/v1/reviews", {
        method: "POST",
        body: {
          items: linhas.map((l) => ({ itemCode: l.itemCode, quantity: l.quantity, uomEntry: l.uomEntry })),
          shipToCode: entrega.shipToCode,
          requestedDate: entrega.requestedDate,
          customerReference: entrega.customerReference.trim(),
          comments: entrega.comments.trim(),
        },
      });
      guardarRevisao(dados);
      ir({ tela: "revisao" });
    } catch (e) {
      setErro(e as ErroDaApi);
    } finally {
      setRevisando(false);
    }
  };

  const valorDigitado = (l: LinhaCarrinho) => rascunhos[chave(l)] ?? qtd(l.quantity);
  const confirmarQuantidade = (l: LinhaCarrinho, texto: string) => {
    const q = normalizarQuantidade(texto);
    setRascunhos((r) => ({ ...r, [chave(l)]: texto }));
    if (q && multiploOk(q, l.multiple)) {
      alterarQuantidade(l.itemCode, l.uomEntry, q);
      setRascunhos(({ [chave(l)]: _, ...resto }) => resto);
    }
  };

  const colunas: Column<LinhaCarrinho>[] = [
    {
      key: "produto",
      header: "Produto",
      cell: (l) => {
        const msg = erroDaLinha(linhas.indexOf(l));
        return (
          <div className="pt-produto pt-produto--com-icone">
            <FotoProduto src={l.imagem} unidade={l.unit} alt={l.description} />
            <span className="pt-produto__textos">
              <span className="pt-produto__nome">{l.description}</span>
              <span className="nh-caption nh-num">{l.itemCode}</span>
              {msg && <span className="nh-field__error" role="alert">{msg}</span>}
            </span>
          </div>
        );
      },
    },
    {
      key: "qtd",
      header: "Quantidade",
      width: "190px",
      cell: (l) => {
        const texto = valorDigitado(l);
        const q = normalizarQuantidade(texto);
        const invalida = !q || !multiploOk(q, l.multiple);
        return (
          <div className="pt-incluir">
            <input
              className="nh-field__control pt-qtd nh-num"
              inputMode="decimal"
              aria-label={`Quantidade de ${l.itemCode}`}
              aria-invalid={invalida || undefined}
              value={texto}
              onChange={(e) => confirmarQuantidade(l, e.target.value)}
            />
            <span>{l.unit}</span>
            {invalida && <span className="nh-field__error">múltiplos de {qtd(l.multiple)}</span>}
          </div>
        );
      },
    },
    { key: "preco", header: "Preço ref.", align: "right", numeric: true, width: "120px", cell: (l) => brl(l.refPrice) },
    {
      key: "total",
      header: "Subtotal ref.",
      align: "right",
      numeric: true,
      width: "130px",
      cell: (l) => <span className="nh-table__cell-strong">{brl(somaReferencia([l]))}</span>,
    },
    {
      key: "acao",
      header: <span className="pt-sr">Remover</span>,
      width: "48px",
      cell: (l) => (
        <button type="button" className="pt-icone-btn" onClick={() => remover(l.itemCode, l.uomEntry)} aria-label={`Remover ${l.itemCode}`} title="Remover do carrinho">
          <IconLixo />
        </button>
      ),
    },
  ];

  const temInvalida = linhas.some((l) => {
    const q = normalizarQuantidade(valorDigitado(l));
    return !q || !multiploOk(q, l.multiple);
  });

  if (linhas.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Seu carrinho está vazio"
          description="Inclua itens pelo catálogo para montar o pedido."
          action={<Button variant="primary" onClick={() => ir({ tela: "catalogo" })}>Abrir o catálogo</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="pt-grade">
      <div className="pt-grade__principal">
        <AvisoPendente />
        {avisoRepetir && <p className="pt-aviso pt-aviso--warn" role="status">{avisoRepetir}</p>}
        {erro && erro.fieldErrors.length === 0 && (
          <p className="pt-aviso pt-aviso--erro" role="alert">
            {erro.message} <span className="nh-caption">Protocolo de atendimento {String(erro.corpo.correlationId ?? "")}.</span>
          </p>
        )}
        {erro && erro.fieldErrors.length > 0 && (
          <p className="pt-aviso pt-aviso--erro" role="alert">
            {erro.message}
          </p>
        )}
        <Card
          title="Carrinho"
          description={`${linhas.length} ${linhas.length === 1 ? "linha" : "linhas"} · valores de referência até a revisão`}
          actions={
            <Button variant="ghost" icon={<IconVoltar size={14} />} onClick={() => ir({ tela: "catalogo" })}>
              Continuar comprando
            </Button>
          }
          flush
        >
          {estreito ? (
            <ul className="pt-cartoes">
              {linhas.map((l) => {
                const texto = valorDigitado(l);
                const q = normalizarQuantidade(texto);
                const invalida = !q || !multiploOk(q, l.multiple);
                const msg = erroDaLinha(linhas.indexOf(l));
                return (
                  <li key={chave(l)} className="pt-cartao">
                    <div className="pt-cartao__topo">
                      <FotoProduto src={l.imagem} unidade={l.unit} alt={l.description} grande />
                      <div className="pt-produto__textos">
                        <span className="pt-produto__nome">{l.description}</span>
                        <span className="nh-caption nh-num">
                          {l.itemCode} · {brl(l.refPrice)} por {l.unit}
                        </span>
                        {msg && <span className="nh-field__error" role="alert">{msg}</span>}
                      </div>
                      <button type="button" className="pt-icone-btn" onClick={() => remover(l.itemCode, l.uomEntry)} aria-label={`Remover ${l.itemCode}`}>
                        <IconLixo />
                      </button>
                    </div>
                    <div className="pt-cartao__acoes">
                      <Quantidade valor={texto} multiplo={l.multiple} rotulo={l.itemCode} invalida={invalida} onChange={(v) => confirmarQuantidade(l, v)} />
                      <span className="pt-cartao__subtotal nh-num">{brl(somaReferencia([l]))}</span>
                    </div>
                    {invalida && <span className="nh-field__error">Vendido em múltiplos de {qtd(l.multiple)}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Table columns={colunas} rows={linhas} rowKey={chave} dense />
          )}
        </Card>
      </div>

      <aside className="pt-grade__lateral">
        <Card title="Entrega" description="Endereços do seu cadastro no SAP.">
          <div className="pt-pilha">
            {erroEnderecos && <p className="nh-field__error">{erroEnderecos}</p>}
            {!enderecos && !erroEnderecos && <Skeleton height="32px" />}
            {enderecos && (
              <Select
                label="Endereço de entrega"
                value={entrega.shipToCode}
                onChange={(e) => alterarEntrega({ shipToCode: e.target.value })}
                options={enderecos.map((a) => ({ value: a.code, label: `${a.code} — ${a.street}, ${a.district}` }))}
                error={erroDoCampo("shipToCode")}
                hint={(() => {
                  const a = enderecos.find((x) => x.code === entrega.shipToCode);
                  return a ? `${a.city}/${a.state} · CEP ${a.zip}` : undefined;
                })()}
                required
              />
            )}
            <Input
              label="Data desejada de entrega"
              type="date"
              min={dataLocal(1)}
              max={dataLocal(60)}
              value={entrega.requestedDate}
              onChange={(e) => alterarEntrega({ requestedDate: e.target.value })}
              error={erroDoCampo("requestedDate")}
              hint="A data final depende da programação logística."
              required
            />
            <Input
              label="Sua referência (nº da ordem de compra)"
              maxLength={100}
              value={entrega.customerReference}
              onChange={(e) => alterarEntrega({ customerReference: e.target.value })}
              error={erroDoCampo("customerReference")}
            />
            <Textarea
              label="Observação para a entrega"
              maxLength={MAX_OBS}
              rows={3}
              value={entrega.comments}
              onChange={(e) => alterarEntrega({ comments: e.target.value })}
              hint={`${entrega.comments.length}/${MAX_OBS}`}
              error={erroDoCampo("comments")}
            />
            <div className="pt-resumo__total">
              <span>Subtotal de referência</span>
              <strong className="nh-num">{brl(somaReferencia(linhas))}</strong>
            </div>
            <Button
              variant="primary"
              size="lg"
              className="pt-largo"
              onClick={revisar}
              loading={revisando}
              disabled={temInvalida || !entrega.shipToCode || Boolean(pendente)}
              title={pendente ? "Consulte o envio anterior antes de revisar outro pedido" : undefined}
            >
              Revisar pedido
            </Button>
            <p className="nh-caption">Na revisão o SAP recalcula preço, impostos e frete. Nada é enviado ainda.</p>
          </div>
        </Card>
      </aside>
    </div>
  );
}

const chave = (l: { itemCode: string; uomEntry: number }) => `${l.itemCode}:${l.uomEntry}`;
