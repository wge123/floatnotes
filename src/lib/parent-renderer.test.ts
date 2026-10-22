import { describe, expect, it } from "vitest";

import { MissingParentRendererError, callParent } from "./parent-renderer";

describe("callParent", () => {
  it("returns what the stock handler returns", () => {
    expect(callParent("Image", (a: number) => `x${a}`, 1)).toBe("x1");
  });

  it("returns an empty but defined result untouched", () => {
    expect(callParent("Image", () => "")).toBe("");
    expect(callParent("Paragraph", () => [])).toEqual([]);
  });

  it("throws a named error when there is no stock handler", () => {
    expect(() => callParent("Image", undefined)).toThrow(MissingParentRendererError);
    expect(() => callParent("Image", undefined)).toThrow(/Image/);
  });

  it("throws when the stock handler returns nothing", () => {
    expect(() => callParent("ListItem", () => undefined)).toThrow(MissingParentRendererError);
  });
});
