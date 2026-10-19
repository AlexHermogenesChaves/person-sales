import { useCarrinho } from "../estado";
import { ir } from "../rotas";
import { Button } from "../ui";
import { IconAlerta } from "../ui/icons";

/** Envio anterior sem desfecho conhecido: consultar antes de mandar outro. */
export function AvisoPendente() {
  const { pendente } = useCarrinho();
  if (!pendente) return null;
  return (
    <div className="pt-faixa pt-faixa--warn" role="status">
      <IconAlerta />
      <div>
        <strong>Há um envio aguardando confirmação.</strong>
        <span> Protocolo {pendente.slice(0, 8)}. Consulte o resultado antes de enviar um pedido parecido.</span>
      </div>
      <Button size="sm" onClick={() => ir({ tela: "protocolo", operationId: pendente })}>
        Consultar protocolo
      </Button>
    </div>
  );
}
