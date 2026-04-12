/** Format structured data as an aligned CLI table. Returns a string (does not print). */
export function formatTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return headers.join("  ");
  }

  const colCount = headers.length;
  const widths: number[] = headers.map((h) => h.length);

  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      const cell = row[i] ?? "";
      if (cell.length > widths[i]) {
        widths[i] = cell.length;
      }
    }
  }

  const pad = (value: string, width: number): string =>
    value + " ".repeat(Math.max(0, width - value.length));

  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => (i < colCount - 1 ? pad(cell, widths[i]) : cell)).join("  ");

  const lines: string[] = [];
  lines.push(formatRow(headers));

  for (const row of rows) {
    const cells = Array.from({ length: colCount }, (_, i) => row[i] ?? "");
    lines.push(formatRow(cells));
  }

  return lines.join("\n");
}
