import type { ReactNode } from "react";

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
  minWidth?: string;
  getRowClassName?: (row: T) => string;
};

const alignClasses = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  minWidth = "640px",
  getRowClassName,
}: DataTableProps<T>) {
  return (
    <div className="table-shell">
      <table className="data-table" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={alignClasses[column.align ?? "left"]}
                key={column.key}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={getRowClassName?.(row)} key={getRowKey(row)}>
              {columns.map((column) => (
                <td
                  className={[
                    alignClasses[column.align ?? "left"],
                    column.className,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={column.key}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
