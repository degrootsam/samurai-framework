import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEXT_LOCATE } from "./text-locator.js";

/** A tiny DOM: elements with text and children, enough to run TEXT_LOCATE in Node */
class FakeElement {
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  constructor(
    public tagName: string,
    private ownText = "",
  ) {}
  add(...kids: FakeElement[]) {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
  get innerText(): string {
    return [this.ownText, ...this.children.map((kid) => kid.innerText)].filter(Boolean).join(" ");
  }
  get textContent(): string {
    return this.innerText;
  }
  descendants(): FakeElement[] {
    return this.children.flatMap((kid) => [kid, ...kid.descendants()]);
  }
  querySelectorAll() {
    return this.descendants();
  }
  compareDocumentPosition(other: FakeElement) {
    const order = all(root());
    return order.indexOf(other) > order.indexOf(this) ? 4 : 2;
  }
}
let documentRoot: FakeElement;
const root = () => documentRoot;
const all = (from: FakeElement): FakeElement[] => [from, ...from.descendants()];

function run(start: FakeElement[] | null, value: string, match: string, ignoreCase: boolean) {
  const fn = new Function(
    "document",
    `return (${TEXT_LOCATE})`,
  )({ documentElement: documentRoot, querySelectorAll: () => documentRoot.descendants() }) as (
    starts: unknown[],
    value: string,
    match: string,
    ignoreCase: boolean,
  ) => FakeElement[];
  return fn(start ?? [], value, match, ignoreCase);
}

describe("TEXT_LOCATE", () => {
  it("compiles as a function declaration", () => {
    assert.doesNotThrow(() => new Function(`return (${TEXT_LOCATE})`));
  });

  it("finds the innermost element with the full text", () => {
    const span = new FakeElement("SPAN", "Go");
    const div = new FakeElement("DIV").add(span);
    documentRoot = new FakeElement("HTML").add(new FakeElement("BODY").add(div));
    assert.deepEqual(run(null, "Go", "full", false), [span]);
  });

  it("normalises whitespace on both sides", () => {
    const p = new FakeElement("P", "  Hello \n  world ");
    documentRoot = new FakeElement("HTML").add(p);
    assert.deepEqual(run(null, "Hello world", "full", false), [p]);
    assert.deepEqual(run(null, "  Hello   world", "full", false), [p]);
  });

  it("full needs the whole text, partial a substring", () => {
    const p = new FakeElement("P", "Sign in now");
    documentRoot = new FakeElement("HTML").add(p);
    assert.deepEqual(run(null, "Sign in", "full", false), []);
    assert.deepEqual(run(null, "Sign in", "partial", false), [p]);
  });

  it("ignoreCase compares lower-cased", () => {
    const p = new FakeElement("P", "Sign IN");
    documentRoot = new FakeElement("HTML").add(p);
    assert.deepEqual(run(null, "sign in", "full", false), []);
    assert.deepEqual(run(null, "sign in", "full", true), [p]);
  });

  it("returns the parent when the text is only complete across its children", () => {
    const b = new FakeElement("B", "Hel");
    const p = new FakeElement("P", "lo").add(b);
    documentRoot = new FakeElement("HTML").add(p);
    // innerText is "lo Hel" here, so use text that only the parent contains in full
    assert.deepEqual(run(null, "lo Hel", "full", false), [p]);
  });

  it("returns every innermost match in document order", () => {
    const a = new FakeElement("LI", "x");
    const b = new FakeElement("LI", "x");
    documentRoot = new FakeElement("HTML").add(new FakeElement("UL").add(a, b));
    assert.deepEqual(run(null, "x", "full", false), [a, b]);
  });

  it("searches only inside the start nodes, without repeating a match found from two of them", () => {
    const inside = new FakeElement("SPAN", "hit");
    const nested = new FakeElement("DIV").add(inside);
    const outside = new FakeElement("SPAN", "hit");
    const form = new FakeElement("FORM").add(nested);
    documentRoot = new FakeElement("HTML").add(form, outside);
    assert.deepEqual(run([form], "hit", "full", false), [inside]);
    assert.deepEqual(run([form, nested], "hit", "full", false), [inside]);
  });

  it("skips non-rendered elements", () => {
    const script = new FakeElement("SCRIPT", "Go");
    const p = new FakeElement("P", "Go");
    documentRoot = new FakeElement("HTML").add(new FakeElement("HEAD").add(script), p);
    assert.deepEqual(run(null, "Go", "full", false), [p]);
  });
});
