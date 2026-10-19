import { useEffect, useState } from "react";
import { api, ErroDaApi, type Envio, type Revisao as DadosRevisao } from "../api";
import { guardarRevisao, marcarPendente, useCarrinho } from "../estado";
import { brl, dataBr, qtd } from "../formato";
import { ir } from "../rotas";
import { Badge, Button, Card, EmptyState, Table, type Column } from "../ui";
import { IconAlerta, IconRelogio, IconVoltar } from "../ui/icons";
import { guardarResultado } from "./Protocolo";

export function Revisao() {
  const { revisao, linhas } = useCarrinho();
  const [restante, setRestante] = useState(() => segundosAte(revisao?.expiresAt));
  const [enviando, setEnviando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [erro, setErro] = useState<ErroDaApi | null>(null);

  useEffect(() => {
    setRestante(segundosAte(revisao?.expiresAt));
    const t = setInterval(() => setRestante(segundosAte(revisao?.expiresAt)), 1000);
    return () => clearInterval(t);
  }, [revisao?.expiresAt]);

  if (!revisao) {
    return (
      <Card>
        <EmptyState
          title="Nenhuma revisão em andamento"
          description={linhas.length ? "O carrinho mudou ou a página foi recarregada. Revise de novo para conferir os valores." : "Monte o pedido no catálogo."}
          action={<Button variant="primary" onClick={() => ir({ tela: linhas.length ? "carrinho" : "catalogo" })}>{linhas.length ? "Voltar ao carrinho" : "Abrir o catálogo"}</Button>}
        />
      </Card>
    );
  }

  const expirada = restante <= 0;

  const revisarDeNovo = async () => {
    setErro(null);
    setRevisando(true);
    try {
      const { dados } = await api<DadosRevisao>("/api/v1/reviews", {
        method: "POST",
        body: {
          items: linhas.map((l) => ({ itemCode: l.itemCode, quantity: l.quantity, uomEntry: l.uomEntry })),
          shipToCode: revisao.shipTo.codigo,
          requestedDate: revisao.requestedDate,
          customerReference: revisao.customerReference,
          comments: revisao.comments,
        },
      });
      guardarRevisao(dados);
    } catch (e) {
      setErro(e as ErroDaApi);
    } finally {
      setRevisando(false);
    }
  };

  const enviar = async () => {
    setErro(null);
    setEnviando(true);
    marcarPendente(revisao.operationId);
    try {
      const { dados } = await api<Envio>("/api/v1/orders", {
        method: "POST",
        headers: { "Idempotency-Key": revisao.operationId },
        body: { operationId: revisao.operationId, reviewToken: revisao.reviewToken },
      });
      guardarResultado(dados);
      ir({ tela: "protocolo", operationId: revisao.operationId });
    } catch (e) {
      const falha = e as ErroDaApi;
      // Sem registro durável no SAP: nada foi aceito, o protocolo pendente cai.
      const semRegistro = ["REVIEW_CHANGED", "REVIEW_EXPIRED", "SAP_UNAVAILABLE", "RESERVATION_REJECTED", "RATE_LIMITED", "ORDER_RULES"].includes(falha.code);
      if (semRegistro) {
        marcarPendente(null);
        setErro(falha);
        setEnviando(false);
        return;
      }
      // Rejeitado, reserva incerta ou queda de conexão: o protocolo decide.
      if (falha.corpo.status) guardarResultado(falha.corpo as unknown as Envio);
      ir({ tela: "protocolo", operationId: revisao.operationId });
    }
  };

  const colunas: Column<DadosRevisao["lines"][number]>[] = [
    {
      key: "produto",
      header: "Produto",
      cell: (l) => (
        <div className="pt-produto">
          <span className="pt-produto__nome">{l.description}</span>
          <span className="nh-caption nh-num">{l.itemCode}</span>
        </div>
      ),
    },
    { key: "qtd", header: "Quantidade", numeric: true, align: "right", cell: (l) => `${qtd(l.quantity)} ${l.unit}` },
    {
      key: "preco",
      header: "Preço unit.",
      numeric: true,
      align: "right",
      cell: (l) => (
        <div className="pt-preco">
          <span>{brl(l.unitPrice)}</span>
          {l.priceOrigin === "ESPECIAL" && <Badge tone="ok">contrato</Badge>}
          {l.priceOrigin === "QUANTIDADE" && <Badge tone="info">faixa por quantidade</Badge>}
        </div>
      ),
    },
    { key: "imp", header: "Impostos", numeric: true, align: "right", cell: (l) => brl(l.tax) },
    { key: "total", header: "Total da linha", numeric: true, align: "right", cell: (l) => <span className="nh-table__cell-strong">{brl(l.lineTotal)}</span> },
  ];

  return (
    <div className="pt-grade">
      <div className="pt-grade__principal">
        {erro && (
          <div className="pt-faixa pt-faixa--danger" role="alert">
            <IconAlerta />
            <div>
              <strong>{erro.message}</strong>
              <span className="nh-caption"> Protocolo de atendimento {String(erro.corpo.correlationId ?? "—")}.</span>
            </div>
            {(erro.code === "REVIEW_CHANGED" || erro.code === "REVIEW_EXPIRED") && (
              <Button size="sm" onClick={revisarDeNovo} loading={revisando}>
                Revisar de novo
              </Button>
            )}
          </div>
        )}
        <Card
          title="Revisão do pedido"
          description="Valores calculados agora pelo SAP para a sua empresa. Confira antes de enviar."
          actions={
            <Button variant="ghost" icon={<IconVoltar size={14} />} onClick={() => ir({ tela: "carrinho" })}>
              Alterar pedido
            </Button>
          }
          flush
        >
          <Table columns={colunas} rows={revisao.lines} rowKey={(l) => `${l.itemCode}:${l.uomEntry}`} dense />
        </Card>
        <Card title="Entrega">
          <dl className="pt-dados">
            <div>
              <dt>Endereço</dt>
              <dd>
                <strong>{revisao.shipTo.codigo}</strong> — {revisao.shipTo.logradouro}, {revisao.shipTo.bairro}, {revisao.shipTo.cidade}/{revisao.shipTo.uf}
              </dd>
            </div>
            <div>
              <dt>Data desejada</dt>
              <dd className="nh-num">{dataBr(revisao.requestedDate)}</dd>
            </div>
            <div>
              <dt>Sua referência</dt>
              <dd>{revisao.customerReference || "—"}</dd>
            </div>
            <div>
              <dt>Observação</dt>
              <dd className="pt-quebra">{revisao.comments || "—"}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <aside className="pt-grade__lateral">
        <Card title="Totais">
          <dl className="pt-totais">
            <div>
              <dt>Subtotal</dt>
              <dd className="nh-num">{brl(revisao.subtotal)}</dd>
            </div>
            <div>
              <dt>Impostos</dt>
              <dd className="nh-num">{revisao.totalsAreFinal ? brl(revisao.tax) : "a calcular"}</dd>
            </div>
            <div>
              <dt title="Despesa adicional calculada pelo SAP (frete abaixo do pedido mínimo)">Frete e despesas</dt>
              <dd className="nh-num">{revisao.totalsAreFinal ? brl(revisao.expenses) : "a calcular"}</dd>
            </div>
            <div className="pt-totais__total">
              <dt>Total</dt>
              <dd className="nh-num">{revisao.totalsAreFinal ? brl(revisao.total) : "pendente"}</dd>
            </div>
          </dl>
          {revisao.approvalExpected && (
            <p className="pt-aviso pt-aviso--warn">
              Este pedido passa por <strong>aprovação comercial</strong> no SAP. Você recebe o protocolo agora e o número do pedido depois da aprovação.
            </p>
          )}
          <p className={expirada ? "pt-validade pt-validade--fim" : "pt-validade"} aria-live="polite">
            <IconRelogio size={14} />
            {expirada ? "Revisão expirada: os preços precisam ser conferidos de novo." : `Valores garantidos por ${mmss(restante)}`}
          </p>
          {expirada ? (
            <Button variant="primary" size="lg" className="pt-largo" onClick={revisarDeNovo} loading={revisando}>
              Revisar de novo
            </Button>
          ) : (
            <Button variant="primary" size="lg" className="pt-largo" onClick={enviar} loading={enviando} disabled={!revisao.totalsAreFinal}>
              {enviando ? "Enviando ao SAP…" : "Enviar pedido"}
            </Button>
          )}
          <p className="nh-caption">Ao enviar, o pedido é registrado com um protocolo único. Repetir o clique não cria outro pedido.</p>
        </Card>
      </aside>
    </div>
  );
}

const segundosAte = (iso?: string) => (iso ? Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000)) : 0);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
