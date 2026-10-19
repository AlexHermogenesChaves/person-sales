import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { brl, haQuanto } from "../formato";
import { Badge, Button, Switch, type BadgeTone } from "../ui";
import { IconFechar } from "../ui/icons";

// Painel da demonstração: mostra o que está gravado no SAP simulado (UDTs e
// documentos) e provoca as falhas que a homologação não deixa provocar. Não existe
// no portal real — só quando o servidor roda com SAP_MODE=simulado.

type Reserva = {
  code: string;
  operationId: string;
  cardCode: string;
  estado: string;
  criadoUtc: string;
  atualizadoUtc: string;
  docType: string | null;
  docNum: number | null;
  erro: string | null;
};
type Documento = { tipo: "ORDER" | "DRAFT"; docEntry: number; docNum: number; cardCode: string; portalId: string; total: string | null; criadoUtc: string; aberto: boolean; linhas: number };
type Acesso = { code: string; cardCode: string; ativo: boolean; pessoa: string; cliente: string };
type Estado = {
  falhas: Record<string, boolean>;
  reservas: Reserva[];
  documentos: Documento[];
  acessos: Acesso[];
  precosAlteraveis: { itemCode: string; descricao: string }[];
};

const FALHAS: { chave: string; rotulo: string; dica: string }[] = [
  { chave: "sapForaDoAr", rotulo: "Service Layer fora do ar", dica: "Toda chamada falha antes de sair. Esperado: 503 e carrinho mantido." },
  { chave: "perderRespostaPedido", rotulo: "Perder a resposta do pedido", dica: "O SAP grava o pedido e a resposta some. Esperado: incerto, depois conciliado por U_PRT_ID." },
  { chave: "perderRespostaReserva", rotulo: "Perder a resposta da reserva", dica: "A UDT grava e a resposta some. Esperado: nenhum POST Orders." },
  { chave: "recusarPedido", rotulo: "SAP recusa o pedido", dica: "Limite de crédito excedido. Esperado: REJEITADO, carrinho mantido." },
  { chave: "falharAtualizacaoReserva", rotulo: "Falhar ao atualizar a UDT", dica: "Pedido criado, controle não atualizado. Esperado: sem segundo pedido." },
];

const TOM: Record<string, BadgeTone> = {
  INTEGRADO: "ok",
  AGUARDANDO_APROVACAO: "info",
  PROCESSANDO: "neutral",
  RESULTADO_INCERTO: "warn",
  REJEITADO: "danger",
};

export function Bastidores({ onFechar, onMudou }: { onFechar: () => void; onMudou?: () => void }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [item, setItem] = useState("PA0016");
  const [, setRelogio] = useState(0);

  const atualizar = useCallback(async () => {
    try {
      const { dados } = await api<Estado>("/demo/estado");
      setEstado(dados);
    } catch {
      /* servidor reiniciando */
    }
  }, []);

  useEffect(() => {
    void atualizar();
    const t = setInterval(() => {
      void atualizar();
      setRelogio((n) => n + 1);
    }, 2000);
    return () => clearInterval(t);
  }, [atualizar]);

  const acao = async (caminho: string, corpo: unknown) => {
    const { dados } = await api<Estado>(caminho, { method: "POST", body: corpo });
    setEstado(dados);
    onMudou?.();
  };

  return (
    <aside className="pt-bastidores" aria-label="Bastidores da demonstração">
      <header className="pt-bastidores__topo">
        <div>
          <h2>Bastidores</h2>
          <p className="nh-caption">SAP simulado · o comprador não vê este painel</p>
        </div>
        <button type="button" className="pt-icone-btn" onClick={onFechar} aria-label="Fechar bastidores">
          <IconFechar />
        </button>
      </header>

      {!estado ? (
        <p className="nh-caption">Carregando…</p>
      ) : (
        <div className="pt-bastidores__corpo">
          <section>
            <h3>Provocar falhas</h3>
            <div className="pt-pilha">
              {FALHAS.map((f) => (
                <Switch key={f.chave} label={f.rotulo} hint={f.dica} checked={estado.falhas[f.chave]} onChange={(v) => acao("/demo/falha", { chave: f.chave, valor: v })} />
              ))}
            </div>
          </section>

          <section>
            <h3>
              @PRT_REQUEST <span className="nh-caption">controle de envio</span>
            </h3>
            <ul className="pt-lista-sap">
              {estado.reservas.length === 0 && <li className="nh-caption">Nenhum envio registrado.</li>}
              {estado.reservas.map((r) => (
                <li key={r.code}>
                  <div className="pt-lista-sap__linha">
                    <Badge tone={TOM[r.estado] ?? "neutral"}>{r.estado}</Badge>
                    <span className="nh-caption">{haQuanto(r.atualizadoUtc)}</span>
                  </div>
                  <div className="nh-caption nh-num">
                    Code {r.code.slice(0, 12)}… · {r.cardCode} · op {r.operationId.slice(0, 8)}
                  </div>
                  <div className="nh-caption">
                    {r.docType ? `${r.docType === "ORDER" ? "Pedido" : "Rascunho"} ${r.docNum}` : "sem documento"}
                    {r.erro && <strong className="pt-texto-alerta"> · {r.erro}</strong>}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>
              Orders / Drafts <span className="nh-caption">com U_PRT_ORIG = PORTAL</span>
            </h3>
            <ul className="pt-lista-sap">
              {estado.documentos.map((d) => (
                <li key={`${d.tipo}-${d.docEntry}`} className={d.aberto ? "" : "is-fechado"}>
                  <div className="pt-lista-sap__linha">
                    <strong className="nh-num">
                      {d.tipo === "ORDER" ? "Pedido" : "Rascunho"} {d.docNum}
                    </strong>
                    <span className="nh-num">{brl(d.total)}</span>
                  </div>
                  <div className="nh-caption nh-num">
                    {d.cardCode} · {d.linhas} linhas · U_PRT_ID {d.portalId.slice(0, 8)} · {haQuanto(d.criadoUtc)}
                  </div>
                  {d.tipo === "DRAFT" && d.aberto && (
                    <Button size="sm" onClick={() => acao("/demo/aprovar", { docEntry: d.docEntry })}>
                      Aprovar no SAP
                    </Button>
                  )}
                  {d.tipo === "DRAFT" && !d.aberto && <span className="nh-caption">aprovado e convertido em pedido</span>}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>
              @PRT_ACCESS <span className="nh-caption">vínculos</span>
            </h3>
            <ul className="pt-lista-sap">
              {estado.acessos.map((a) => (
                <li key={a.code} className="pt-lista-sap__linha">
                  <span>
                    <strong>{a.pessoa}</strong>
                    <span className="nh-caption"> → {a.cardCode}</span>
                  </span>
                  <Button size="sm" variant={a.ativo ? "secondary" : "primary"} onClick={() => acao("/demo/vinculo", { code: a.code })}>
                    {a.ativo ? "Desativar" : "Reativar"}
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Reajuste de preço no SAP</h3>
            <p className="nh-caption">Faça a revisão, reajuste e tente enviar: o envio exige nova revisão.</p>
            <div className="pt-linha-acoes">
              <select className="nh-field__control" value={item} onChange={(e) => setItem(e.target.value)} aria-label="Item a reajustar">
                {estado.precosAlteraveis.map((i) => (
                  <option key={i.itemCode} value={i.itemCode}>
                    {i.itemCode} — {i.descricao.slice(0, 28)}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={() => acao("/demo/reajuste", { itemCode: item, percentual: 4 })}>
                +4%
              </Button>
            </div>
          </section>

          <section>
            <Button variant="ghost" onClick={() => acao("/demo/reiniciar", {})}>
              Reiniciar a demonstração
            </Button>
          </section>
        </div>
      )}
    </aside>
  );
}
