export function originalRaw(lines: string[], tokenRaw: string): string {
  const consumed = tokenRaw.split("\n").length;
  return lines.slice(0, consumed).join("\n");
}
