import { Fragment } from "react";
import type { ReactNode } from "react";
import { EmptyState, SkeletonRows } from "./EmptyState";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Célula. Devolva string/número para o caso simples. */
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Número alinhado em tabular-nums — valor, quantidade, contagem. */
  numeric?: boolean;
  width?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  dense?: boolean;
  /** Carregando: mostra skeleton no lugar do corpo, nunca spinner solto. */
  loading?: boolean;
  /** Erro: mensagem + ação de recuperação. */
  error?: { message: string; onRetry?: () => void } | null;
  /** Vazio: obrigatório. Uma tabela sem este texto vira tela morta. */
  empty?: { title: string; description?: string; action?: ReactNode };
  onRowClick?: (row: T) => void;
  /**
   * Painel que abre **abaixo** da linha, ocupando a largura toda. Devolva `null` para
   * as linhas fechadas — quem decide qual está aberta é a tela.
   *
   * Existe porque o detalhe de uma linha (alternativas, ações) precisa nascer colado
   * nela: em modal, a pessoa perde de vista o que estava decidindo; em outra tela,
   * perde o lugar na fila.
   */
  renderDetalhe?: (row: T) => ReactNode;
}

/**
 * Tabela do kit. Os quatro estados (carregando, erro, vazio, com dado) moram
 * aqui de propósito: nenhuma tela pode "esquecer" de tratá-los.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  dense = false,
  loading = false,
  error = null,
  empty,
  onRowClick,
  renderDetalhe,
}: TableProps<T>) {
  if (loading) return <SkeletonRows rows={5} />;

  if (error) {
    return (
      <EmptyState
        variant="error"
        title="Não foi possível carregar"
        description={error.message}
        action={
          error.onRetry && (
            <button className="nh-btn nh-btn--secondary" type="button" onClick={error.onRetry}>
              Tentar de novo
            </button>
          )
        }
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? "Nada por aqui"}
        description={empty?.description}
        action={empty?.action}
      />
    );
  }

  return (
    <div className="nh-table-wrap">
      <table className={dense ? "nh-table nh-table--dense" : "nh-table"}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} data-align={c.align ?? "left"} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const detalhe = renderDetalhe?.(row);
            return (
              <Fragment key={rowKey(row)}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} data-align={c.align ?? "left"} data-numeric={c.numeric || undefined}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
                {detalhe && (
                  <tr className="nh-table__detalhe">
                    <td colSpan={columns.length} style={{ padding: 0 }}>
                      {detalhe}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
