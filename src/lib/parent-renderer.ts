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
  return (parent?.(...args) ?? "") as R;
}
