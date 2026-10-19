import type { ErroDaApi } from "../api";
import { Button, Card } from "../ui";
import { IconEscudo } from "../ui/icons";

/** Login válido, mas o SAP não libera: sem vínculo, vínculo desativado ou cliente fora do portal. */
export function SemAcesso({ erro, onSair }: { erro: ErroDaApi; onSair: () => void }) {
  const usuario = erro.corpo.user as { name: string; email: string } | undefined;
  const bloqueado = erro.code === "ACCESS_BLOCKED";
  return (
    <div className="pt-centro">
      <Card className="pt-sem-acesso">
        <div className="pt-sem-acesso__icone" aria-hidden="true">
          <IconEscudo size={20} />
        </div>
        <h1>{bloqueado ? "Acesso suspenso" : "Usuário ainda sem acesso ao portal"}</h1>
        <p>{erro.message}</p>
        {usuario && (
          <p className="nh-caption">
            Conectado como <strong>{usuario.name}</strong> ({usuario.email}).
          </p>
        )}
        <p className="nh-caption">
          {bloqueado
            ? "O vínculo foi desativado no cadastro do cliente no SAP. Nenhum dado comercial fica disponível até a reativação."
            : "O acesso é liberado pela equipe comercial no SAP, vinculando este usuário ao cadastro da sua empresa."}
        </p>
        <Button onClick={onSair}>Sair</Button>
      </Card>
    </div>
  );
}
