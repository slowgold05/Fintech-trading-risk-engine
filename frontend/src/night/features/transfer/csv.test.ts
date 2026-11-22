import { describe, expect, it } from "vitest";
import { encodeCsv, MAX_FILE_BYTES, parseSymbolCsv, readSymbolFile } from "./csv";

describe("watchlist CSV parsing", () => {
  it("preserves decoded cells and the original starting lines of records", () => {
    expect(parseSymbolCsv('\uFEFF"symbol"\r\n aapl \r\n"not, a\r\nsymbol"\r\n\r\n"BRK.B"\r\n"AB""C"')).toEqual([
      { line: 2, symbol: " aapl " },
      { line: 3, symbol: "not, a\r\nsymbol" },
      { line: 5, symbol: "" },
      { line: 6, symbol: "BRK.B" },
      { line: 7, symbol: 'AB"C' },
    ]);
    expect(parseSymbolCsv('symbol\n""\nMSFT\n')).toEqual([
      { line: 2, symbol: "" }, { line: 3, symbol: "MSFT" },
    ]);
  });

  it.each([
    ["ticker\nAAPL", /Line 1.*header/],
    ["symbol,symbol\nAAPL,MSFT", /Line 1.*exactly one column/],
    ["symbol\nAAPL,MSFT", /Line 2.*exactly one column/],
    ['symbol\n"AA\nPL', /Line 2.*unclosed/],
    ['symbol\n"AAPL"abc', /Line 2.*malformed/],
    ['symbol\nAA"PL', /Line 2.*malformed/],
    ["symbol\n", /at least one symbol row/],
    ["", /Line 1.*header/],
  ])("rejects malformed CSV %j", (input, error) => {
    expect(() => parseSymbolCsv(input)).toThrow(error);
  });

  it("accepts the caps and rejects the next row, extra bytes, and malformed UTF-8", async () => {
    const limit = `symbol\n${"SPY\n".repeat(50)}`;
    expect(parseSymbolCsv(limit)).toHaveLength(50);
    expect(() => parseSymbolCsv(limit + "SPY\n")).toThrow(/Line 52.*50-row limit/);
    const bytes = new TextEncoder().encode("symbol\n" + "X".repeat(MAX_FILE_BYTES - 7));
    const file = new File([bytes], "watch.csv");
    expect(await readSymbolFile(file)).toHaveLength(1);
    await expect(readSymbolFile(new File([bytes, "X"], "watch.csv"))).rejects.toThrow(/64 KiB/);
    await expect(readSymbolFile(new File([new Uint8Array([0xc3, 0x28])], "watch.csv"))).rejects.toThrow(/UTF-8/);
  });
});

describe("CSV export encoding", () => {
  it("quotes RFC 4180 fields, preserves numbers and blanks, and neutralizes formula text", () => {
    const csv = encodeCsv(["label", "value"], [
      ['a,"b"\r\nc', null], ["=1+1", -5], ["  +7", 0], ["-1", 7.25], ["\u200B@SUM(1)", undefined],
      ["\tvalue", null], ["\rdog", null], ["   #", null], ["＝A1", null],
    ]);
    expect(csv).toBe(
      'label,value\r\n"a,""b""\r\nc",\r\n\'=1+1,-5\r\n\'  +7,0\r\n\'-1,7.25\r\n\'\u200B@SUM(1),\r\n' +
      "'\tvalue,\r\n\"'\rdog\",\r\n   #,\r\n'＝A1,\r\n",
    );
    expect(encodeCsv(["symbol"], [])).toBe("symbol\r\n");
  });
});
