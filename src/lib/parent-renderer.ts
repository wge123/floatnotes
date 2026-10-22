/**
 * The extensions here wrap TipTap's stock markdown handlers through
 * `this.parent`. If the stock handler were missing, `?.(...) ?? ""` would turn
 * that into an empty string and a save would silently drop the block. Throw
 * instead, naming the extension.
 */
export class MissingParentRendererError extends Error {
  constructor(name: string) {
    super(`${name}: the stock TipTap handler is missing or returned nothing`);
    this.name = "MissingParentRendererError";
  }
}

export function callParent<A extends unknown[], R>(
  name: string,
  parent: ((...args: A) => R | undefined) | undefined,
  ...args: A
): R {
  const result = parent?.(...args);
  if (result === undefined) throw new MissingParentRendererError(name);
  return result;
}
