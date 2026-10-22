/**
 * Both list tokenizers here run the stock tokenizer on a modified copy of the
 * source (padded or shifted), then must report the ORIGINAL text it consumed
 * so the lexer's position stays right. Stock tokenizers disagree on whether
 * `raw` ends in a newline (task lists do, numbered lists do not), so count
 * lines the one way for both: a trailing newline ends the last line, it does
 * not start another.
 */
export function originalRaw(lines: string[], tokenRaw: string): string {
  const endsWithNewline = tokenRaw.endsWith("\n");
  const consumed = tokenRaw.split("\n").length - (endsWithNewline ? 1 : 0);
  return lines.slice(0, consumed).join("\n") + (endsWithNewline ? "\n" : "");
}
