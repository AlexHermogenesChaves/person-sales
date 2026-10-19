import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ErroDaApi, type Envio } from "../api";
import { concluirPedido, marcarPendente, useCarrinho } from "../estado";
import { ir } from "../rotas";
import { Button, Card, Skeleton } from "../ui";
import { IconAlerta, IconAtualizar, IconCheck, IconRelogio } from "../ui/icons";

// Resultado do POST guardado em memória para a tela abrir sem piscar; a consulta ao
// servidor roda de qualquer forma, porque é ela que concilia com o SAP.
const ultimos = new Map<string, Envio>();
export const guardarResultado = (e: Envio) => ultimos.set(e.operationId, e);

type Situacao = { tipo: "ok"; envio: Envio } | { tipo: "erro"; erro: ErroDaApi } | { tipo: "carregando" };

export function Protocolo({ operationId, cliente }: { operationId: string; cliente: string }) {
  const { pendente } = useCarrinho();
  const [situacao, setSituacao] = useState<Situacao>(() => {
    const e = ultimos.get(operationId);
    return e ? { tipo: "ok", envio: e } : { tipo: "carregando" };
  });
  const [consultando, setConsultando] = useState(false);
  const [confirmarNovo, setConfirmarNovo] = useState(false);
  const consultas = useRef(0);

  const consultar = useCallback(async () => {
    setConsultando(true);
    try {
      const { dados } = await api<Envio>(`/api/v1/submissions/${encodeURIComponent(operationId)}`);
      ultimos.set(operationId, dados);
      setSituacao({ tipo: "ok", envio: dados });
    } catch (e) {
      setSituacao((s) => (s.tipo === "ok" && (e as ErroDaApi).status === 503 ? s : { tipo: "erro", erro: e as ErroDaApi }));
    } finally {
      setConsultando(false);
      consultas.current++;
    }
  }, [operationId]);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  const estado = situacao.tipo === "ok" ? situacao.envio.status : null;

  // Desfecho conhecido: o protocolo deixa de bloquear novo pedido.
  useEffect(() => {
    if (pendente !== operationId) return;
    if (estado === "INTEGRADO" || estado === "AGUARDANDO_APROVACAO") concluirPedido();
    if (estado === "REJEITADO") marcarPendente(null);
  }, [estado, pendente, operationId]);

  // PROCESSANDO costuma resolver em segundos: consulta sozinha algumas vezes.
  useEffect(() => {
    if (estado !== "PROCESSANDO" || consultas.current > 10) return;
    const t = setTimeout(consultar, 3000);
    return () => clearTimeout(t);
  }, [estado, consultar, situacao]);

  const curto = operationId.slice(0, 8);

  if (situacao.tipo === "carregando") {
    return (
      <Card>
        <div className="pt-protocolo" aria-busy="true">
          <Skeleton height="20px" width="40%" />
          <Skeleton height="12px" width="70%" />
        </div>
      </Card>
    );
  }

  if (situacao.tipo === "erro") {
    const naoEncontrado = situacao.erro.status === 404;
    return (
      <Resultado
        tom="warn"
        icone={<IconAlerta />}
        titulo={naoEncontrado ? "Protocolo não localizado" : "Não foi possível consultar o protocolo"}
        texto={
          naoEncontrado
            ? "Ainda não há registro deste envio para a sua empresa. Isso não prova que ele não será gravado: guarde o protocolo e consulte de novo em instantes."
            : situacao.erro.message
        }
        protocolo={operationId}
        acoes={
          <>
            <Button icon={<IconAtualizar size={14} />} onClick={consultar} loading={consultando}>
              Consultar novamente
            </Button>
            {naoEncontrado && pendente === operationId && (
              <Button variant="ghost" onClick={() => marcarPendente(null)}>
                Descartar este protocolo
              </Button>
            )}
          </>
        }
      />
    );
  }

  const { envio } = situacao;
  const doc = envio.document;

  switch (envio.status) {
    case "INTEGRADO":
      return (
        <Resultado
          tom={envio.code === "TOTAL_MISMATCH" || envio.code === "TOTAL_DIVERGENTE" ? "warn" : "ok"}
          icone={<IconCheck />}
          titulo={`Pedido ${doc?.docNum ?? ""} registrado no SAP`}
          texto={envio.code ? envio.message : `O pedido de ${cliente} foi incluído e segue para a programação de entrega.`}
          protocolo={operationId}
          detalhes={[
            ["Número do pedido", String(doc?.docNum ?? "—")],
            ["Protocolo do portal", curto],
          ]}
          acoes={
            <Button variant="primary" onClick={() => ir({ tela: "catalogo" })}>
              Fazer outro pedido
            </Button>
          }
        />
      );
    case "AGUARDANDO_APROVACAO":
      return (
        <Resultado
          tom="info"
          icone={<IconRelogio />}
          titulo="Pedido recebido — aguardando aprovação comercial"
          texto="Ainda não é um pedido confirmado. Quando a aprovação acontecer no SAP, este protocolo passa a mostrar o número do pedido."
          protocolo={operationId}
          detalhes={[
            ["Rascunho no SAP", String(doc?.docNum ?? "—")],
            ["Protocolo do portal", curto],
          ]}
          acoes={
            <>
              <Button icon={<IconAtualizar size={14} />} onClick={consultar} loading={consultando}>
                Consultar situação
              </Button>
              <Button variant="ghost" onClick={() => ir({ tela: "catalogo" })}>
                Fazer outro pedido
              </Button>
            </>
          }
        />
      );
    case "REJEITADO":
      return (
        <Resultado
          tom="danger"
          icone={<IconAlerta />}
          titulo="O SAP recusou o pedido"
          texto={`${envio.message} Seu carrinho foi mantido.`}
          protocolo={operationId}
          acoes={
            <Button variant="primary" onClick={() => ir({ tela: "carrinho" })}>
              Voltar ao carrinho
            </Button>
          }
        />
      );
    case "PROCESSANDO":
      return (
        <Resultado
          tom="info"
          icone={<IconRelogio />}
          titulo="Pedido em processamento"
          texto={envio.message}
          protocolo={operationId}
          acoes={
            <Button icon={<IconAtualizar size={14} />} onClick={consultar} loading={consultando}>
              Consultar novamente
            </Button>
          }
        />
      );
    case "RESULTADO_INCERTO":
      return (
        <Resultado
          tom="warn"
          icone={<IconAlerta />}
          titulo="Envio sem confirmação do SAP"
          texto={envio.message}
          protocolo={operationId}
          detalhes={[
            ["Protocolo do portal", curto],
            ["Atendimento", envio.correlationId],
          ]}
          acoes={
            <>
              <Button icon={<IconAtualizar size={14} />} onClick={consultar} loading={consultando}>
                Consultar novamente
              </Button>
              {pendente === operationId &&
                (confirmarNovo ? (
                  <Button variant="danger" onClick={() => marcarPendente(null)}>
                    Confirmo: pode haver pedido duplicado
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmarNovo(true)}>
                    Iniciar outro pedido mesmo assim
                  </Button>
                ))}
            </>
          }
        />
      );
  }
}

function Resultado({
  tom,
  icone,
  titulo,
  texto,
  protocolo,
  detalhes = [],
  acoes,
}: {
  tom: "ok" | "info" | "warn" | "danger";
  icone: ReactNode;
  titulo: string;
  texto: string;
  protocolo: string;
  detalhes?: [string, string][];
  acoes: ReactNode;
}) {
  return (
    <Card>
      <div className={`pt-protocolo pt-protocolo--${tom}`}>
        <span className="pt-protocolo__icone" aria-hidden="true">
          {icone}
        </span>
        <h1>{titulo}</h1>
        <p>{texto}</p>
        {detalhes.length > 0 && (
          <dl className="pt-protocolo__dados">
            {detalhes.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className="nh-num">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="nh-caption nh-num" title="Guarde este identificador para falar com o atendimento">
          Protocolo completo: {protocolo}
        </p>
        <div className="pt-protocolo__acoes">{acoes}</div>
      </div>
    </Card>
  );
}
