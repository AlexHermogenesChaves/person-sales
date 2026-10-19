import { useEffect, useRef, useState } from "react";
import { brl, dataBr, qtd } from "../formato";
import { comprarDeNovo, ORIGEM, previsaoVencida, SITUACAO, type Pedido } from "../historico";
import { ir } from "../rotas";
import { Badge, Button } from "../ui";
import { IconCarrinho, IconCheck, IconFechar } from "../ui/icons";

// Painel lateral do pedido. Exceção pedida (19/10/2026) à regra do kit de abrir o
// detalhe na linha: aqui o detalhe é grande demais (trilho + itens) para caber nela,
// e a lista continua visível à esquerda.

type Etapa = { rotulo: string; data: string | null; estado: "feita" | "atual" | "pendente" };

function etapas(p: Pedido): Etapa[] {
  const m = p.milestones;
  const enviado: Etapa = { rotulo: "Enviado", data: m.sent, estado: "feita" };
  if (p.status === "CANCELADO") {
    return [enviado, { rotulo: "Cancelado", data: m.completed, estado: "atual" }];
  }
  const aprovado: Etapa = { rotulo: p.status === "AGUARDANDO_APROVACAO" ? "Em aprovação" : "Aprovado", data: m.approved, estado: m.approved ? "feita" : "atual" };
  const faturado: Etapa = {
    rotulo: p.status === "PARCIAL" ? "Faturado em parte" : "Faturado",
    data: m.invoiced,
    estado: p.status === "FATURADO" ? "feita" : p.status === "PARCIAL" ? "atual" : m.approved ? "atual" : "pendente",
  };
  const concluido: Etapa = { rotulo: "Concluído", data: m.completed, estado: p.status === "FATURADO" ? "feita" : "pendente" };
  // Aprovado sem nota: a etapa atual é esperar o faturamento.
  if (p.status === "APROVADO") faturado.rotulo = "Aguardando faturamento";
  return [enviado, aprovado, faturado, concluido];
}

export function PainelPedido({ pedido, hoje, onFechar }: { pedido: Pedido; hoje: string; onFechar: () => void }) {
  const fechar = useRef<HTMLButtonElement>(null);
  const [repetindo, setRepetindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    fechar.current?.focus();
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", tecla);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", tecla);
      document.body.style.overflow = "";
    };
  }, [onFechar]);

  const repetir = async () => {
    setRepetindo(true);
    setAviso(null);
    try {
      const { fora } = await comprarDeNovo(pedido.lines.map((l) => ({ itemCode: l.itemCode, uomEntry: l.uomEntry, quantity: l.quantity })));
      if (fora.length === pedido.lines.length) setAviso("Nenhum item deste pedido está liberado no catálogo hoje.");
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setRepetindo(false);
    }
  };

  const vencida = previsaoVencida(pedido, hoje);
  const titulo = pedido.type === "DRAFT" ? `Rascunho ${pedido.docNum}` : `Pedido ${pedido.docNum}`;

  return (
    <div className="pt-gaveta" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <aside className="pt-gaveta__painel" role="dialog" aria-modal="true" aria-label={titulo}>
        <header className="pt-gaveta__topo">
          <div>
            <h2 className="nh-num">{titulo}</h2>
            <p className="nh-caption">
              {ORIGEM[pedido.origin]} · {dataBr(pedido.date)} · {brl(pedido.total)}
              {pedido.customerReference && ` · ${pedido.customerReference}`}
            </p>
          </div>
          <button ref={fechar} type="button" className="pt-icone-btn" onClick={onFechar} aria-label="Fechar">
            <IconFechar />
          </button>
        </header>

        <div className="pt-gaveta__corpo">
          <ol className="pt-trilho" aria-label="Andamento do pedido">
            {etapas(pedido).map((e) => (
              <li key={e.rotulo} className={`pt-trilho__etapa is-${e.estado}`} aria-current={e.estado === "atual" ? "step" : undefined}>
                <span className="pt-trilho__marca" aria-hidden="true">
                  {e.estado === "feita" && <IconCheck size={12} />}
                </span>
                <span className="pt-trilho__rotulo">{e.rotulo}</span>
                <span className="nh-caption nh-num">{e.data ? dataBr(e.data) : "—"}</span>
              </li>
            ))}
          </ol>

          <dl className="pt-gaveta__dados">
            <div>
              <dt>Situação</dt>
              <dd>
                <Badge tone={SITUACAO[pedido.status].tom} dot>
                  {SITUACAO[pedido.status].rotulo}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Previsão</dt>
              <dd className={vencida ? "nh-num pt-texto-perigo" : "nh-num"} title={vencida ? "A previsão já passou e ainda há itens a faturar" : undefined}>
                {pedido.status === "FATURADO" || pedido.status === "CANCELADO" ? "—" : dataBr(pedido.expectedDate)}
                {vencida && " · vencida"}
              </dd>
            </div>
            <div>
              <dt>Total do pedido</dt>
              <dd className="nh-num">{brl(pedido.total)}</dd>
            </div>
            <div>
              <dt>Já faturado</dt>
              <dd className="nh-num">{brl(pedido.invoiced)}</dd>
            </div>
            <div>
              <dt>Falta chegar</dt>
              <dd className="nh-num pt-gaveta__destaque">{brl(pedido.pending)}</dd>
            </div>
          </dl>

          <h3 className="pt-gaveta__secao">Itens</h3>
          <div className="nh-table-wrap">
            <table className="pt-detalhe__tabela">
              <thead>
                <tr>
                  <th>Item</th>
                  <th data-align="right">Qtd</th>
                  <th data-align="right">Faturada</th>
                  <th data-align="right">Falta</th>
                  <th data-align="right">Unitário</th>
                  <th data-align="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pedido.lines.map((l) => (
                  <tr key={`${l.itemCode}:${l.uomEntry}`}>
                    <td>
                      <span className="pt-produto__nome nh-num">{l.itemCode}</span>
                      <span className="pt-gaveta__descricao">{l.description}</span>
                    </td>
                    <td data-align="right" className="nh-num">
                      {qtd(l.quantity)} {l.unit}
                    </td>
                    <td data-align="right" className="nh-num">
                      {qtd(l.invoicedQuantity)}
                    </td>
                    <td data-align="right" className={Number(l.pendingQuantity) > 0 ? "nh-num pt-texto-alerta" : "nh-num"}>
                      {Number(l.pendingQuantity) > 0 ? qtd(l.pendingQuantity) : "—"}
                    </td>
                    <td data-align="right" className="nh-num">
                      {brl(l.unitPrice)}
                    </td>
                    <td data-align="right" className="nh-num">
                      {brl(l.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {aviso && <p className="pt-aviso pt-aviso--warn">{aviso}</p>}
        </div>

        <footer className="pt-gaveta__rodape">
          {pedido.operationId && (
            <Button variant="ghost" onClick={() => ir({ tela: "protocolo", operationId: pedido.operationId! })}>
              Ver protocolo do portal
            </Button>
          )}
          <Button variant="primary" icon={<IconCarrinho size={14} />} onClick={repetir} loading={repetindo}>
            Repetir este pedido
          </Button>
        </footer>
      </aside>
    </div>
  );
}
