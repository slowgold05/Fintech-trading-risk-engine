export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_IMPORT_ROWS = 50;
export const WATCHLIST_CAP = 50;

export type SymbolRecord = { line: number; symbol: string };

export async function readSymbolFile(file: File): Promise<SymbolRecord[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose a CSV file no larger than 64 KiB.");

  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("Save the CSV as UTF-8 and try again.");
  }
  return parseSymbolCsv(text);
}

export function parseSymbolCsv(text: string): SymbolRecord[] {
  const input = text.replace(/^\uFEFF/, "");
  const records: SymbolRecord[] = [];
  let headerRead = false;
  let line = 1;
  let recordLine = 1;
  let field = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";

  function finishRecord() {
    if (!headerRead) {
      if (field !== "symbol") throw new Error("Line 1 must contain the single column header symbol.");
      headerRead = true;
    } else {
      if (records.length === MAX_IMPORT_ROWS) {
        throw new Error(`Line ${recordLine} exceeds the ${MAX_IMPORT_ROWS}-row limit.`);
      }
      records.push({ line: recordLine, symbol: field });
    }
    state = "start";
    field = "";
  }

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\r" || char === "\n") {
      const end = char === "\r" && input[index + 1] === "\n" ? "\r\n" : char;
      index += end.length - 1;
      if (state === "quoted") {
        field += end;
        line += 1;
      } else {
        finishRecord();
        line += 1;
        recordLine = line;
      }
    } else if (state === "quoted") {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        state = "closed";
      } else {
        field += char;
      }
    } else if (char === ",") {
      throw new Error(`Line ${recordLine} must contain exactly one column.`);
    } else if (char === '"' && state === "start") {
      state = "quoted";
    } else if (char === '"' || state === "closed") {
      throw new Error(`Line ${recordLine} has malformed CSV quoting.`);
    } else {
      field += char;
      state = "plain";
    }
  }

  if (state === "quoted") throw new Error(`Line ${recordLine} has an unclosed CSV quote.`);
  if (!headerRead || state !== "start") finishRecord();
  if (records.length === 0) throw new Error("Add at least one symbol row below the header.");
  return records;
}

type Cell = string | number | null | undefined;

function encodeCell(cell: Cell): string {
  if (cell == null) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";

  // A spreadsheet may ignore leading whitespace or control characters before a formula.
  const beginsFormula = /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(cell);
  const beginsLineControl = /^[^\S\r\n\t]*[\r\n\t]/.test(cell);
  const text = beginsFormula || beginsLineControl ? "'" + cell : cell;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function encodeCsv(headers: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return [headers, ...rows].map(row => row.map(encodeCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly Cell[])[]) {
  const url = URL.createObjectURL(new Blob([encodeCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
