/**
 * Caret guard (step 02 contract: "setContent only if !focused or hash
 * differs"). The dangerous case is the echo of our own onChange arriving back
 * through the value prop while the user is typing — calling setContent then
 * would reset the caret. Equal content is never applied (that covers the echo
 * whether focused or not); genuinely different content is always applied —
 * conflict semantics (409/reload) arrive in step 05.
 */
export function shouldApplyExternal(
  currentMarkdown: string,
  incomingMarkdown: string,
): boolean {
  return currentMarkdown !== incomingMarkdown;
}
