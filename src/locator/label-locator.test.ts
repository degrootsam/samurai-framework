import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LABEL_LOCATE } from "./label-locator.js";

/** A tiny DOM: enough to run LABEL_LOCATE in Node */
class FakeElement {
  children: FakeElement[] = [];
  labels: FakeElement[] | undefined;
  constructor(
    public tagName: string,
    public innerText = "",
    private attrs: Record<string, string> = {},
    public id = "",
  ) {}
  add(...kids: FakeElement[]) {
    this.children.push(...kids);
    return this;
  }
  labelledBy(...labels: FakeElement[]) {
    this.labels = labels;
    return this;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  get textContent() {
    return this.innerText;
  }
  descendants(): FakeElement[] {
    return this.children.flatMap((kid) => [kid, ...kid.descendants()]);
  }
  querySelectorAll() {
    return this.descendants();
  }
  compareDocumentPosition(other: FakeElement) {
    const order = [documentRoot, ...documentRoot.descendants()];
    return order.indexOf(other) > order.indexOf(this) ? 4 : 2;
  }
}
let documentRoot: FakeElement;

function run(starts: FakeElement[], value: string, match = "full", ignoreCase = false) {
  const byId = (id: string) => [documentRoot, ...documentRoot.descendants()].find((el) => el.id === id) ?? null;
  const fn = new Function("document", `return (${LABEL_LOCATE})`)({
    querySelectorAll: () => documentRoot.descendants(),
    getElementById: byId,
  }) as (...args: unknown[]) => FakeElement[];
  return fn(starts, value, match, ignoreCase);
}

describe("LABEL_LOCATE", () => {
  it("compiles as a function declaration", () => {
    assert.doesNotThrow(() => new Function(`return (${LABEL_LOCATE})`));
  });

  it("finds a control by its <label> (el.labels)", () => {
    const label = new FakeElement("LABEL", " Email   address ");
    const input = new FakeElement("INPUT").labelledBy(label);
    documentRoot = new FakeElement("HTML").add(label, input, new FakeElement("INPUT"));
    assert.deepEqual(run([], "Email address"), [input]);
    assert.deepEqual(run([], "Email"), [], "full match needs the whole text");
    assert.deepEqual(run([], "mail", "partial"), [input]);
    assert.deepEqual(run([], "EMAIL ADDRESS", "full", true), [input]);
  });

  it("finds a control by aria-labelledby and aria-label", () => {
    const heading = new FakeElement("H2", "Billing", {}, "h");
    const group = new FakeElement("DIV", "", { "aria-labelledby": "missing h" });
    const named = new FakeElement("BUTTON", "x", { "aria-label": "Close" });
    documentRoot = new FakeElement("HTML").add(heading, group, named);
    assert.deepEqual(run([], "Billing"), [group]);
    assert.deepEqual(run([], "Close"), [named]);
  });

  it("searches only inside the start nodes, in document order, without duplicates", () => {
    const label = new FakeElement("LABEL", "Name");
    const a = new FakeElement("INPUT").labelledBy(label);
    const b = new FakeElement("INPUT").labelledBy(label);
    const formA = new FakeElement("FORM").add(a);
    const formB = new FakeElement("FORM").add(b);
    documentRoot = new FakeElement("HTML").add(formA, formB);
    assert.deepEqual(run([formB], "Name"), [b]);
    assert.deepEqual(run([formB, formA, formA], "Name"), [a, b]);
  });
});
