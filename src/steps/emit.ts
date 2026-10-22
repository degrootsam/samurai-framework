import { formatSize, sizeFromSource } from "./files.js";
import type {
  Expectation,
  FileEntry,
  LocatorCall,
  LocatorSpec,
  PageExpectation,
  Step,
  TextMatcher,
  TextValue,
} from "./model.js";

const str = (value: string) => JSON.stringify(value);

function fileEntryToSource(entry: FileEntry): string {
  if ("path" in entry) return str(entry.path);
  const { name, size, type, sizeSource } = entry.generate;
  const sizeText =
    sizeSource !== undefined && sizeFromSource(sizeSource) === size
      ? sizeSource
      : str(formatSize(size));
  return `generatedFile({ name: ${str(name)}, size: ${sizeText}${type === undefined ? "" : `, type: ${str(type)}`} })`;
}

/** The argument of `setInputFiles` / `dropFiles`: one entry bare, else an array */
export function filesToSource(files: readonly FileEntry[]): string {
  return files.length === 1
    ? fileEntryToSource(files[0]!)
    : `[${files.map(fileEntryToSource).join(", ")}]`;
}
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function textOptions(call: {
  match?: "full" | "partial";
  ignoreCase?: boolean;
}): string {
  const parts = [
    call.match !== undefined && `match: ${str(call.match)}`,
    call.ignoreCase !== undefined && `ignoreCase: ${call.ignoreCase}`,
  ].filter(Boolean);
  return parts.length ? `, { ${parts.join(", ")} }` : "";
}

export function callToSource(call: LocatorCall): string {
  switch (call.method) {
    case "locator":
      return `locator(${str(call.xpath)})`;
    case "getByCss":
      return `getByCss(${str(call.css)})`;
    case "getByText":
    case "getByLabel":
      return `${call.method}(${str(call.text)}${textOptions(call)})`;
    case "getByRole":
      return `getByRole(${str(call.role)}${call.name === undefined ? "" : `, { name: ${str(call.name)} }`})`;
    case "getByTestId":
      return `getByTestId(${str(call.testId)})`;
  }
}

const chainToSource = (chain: readonly LocatorCall[]) =>
  ["page", ...chain.map(callToSource)].join(".");

export function locatorToSource({ chain, fallbacks }: LocatorSpec): string {
  const primary = chainToSource(chain);
  return fallbacks.length === 0
    ? primary
    : `${primary}.withFallbacks(${fallbacks.map(chainToSource).join(", ")})`;
}

export function valueToSource(value: TextValue): string {
  if (value.kind === "literal") return str(value.value);
  const object = value.kind === "env" ? "env" : "secrets";
  return IDENTIFIER.test(value.name)
    ? `${object}.${value.name}`
    : `${object}[${str(value.name)}]`;
}

function matcherToSource(expected: TextMatcher): string {
  return typeof expected === "string"
    ? str(expected)
    : `/${expected.regex.source}/${expected.regex.flags}`;
}

function expectationToSource(
  expectation: Expectation | PageExpectation,
): string {
  switch (expectation.matcher) {
    case "toBeVisible":
    case "toBeHidden":
    case "toBeEnabled":
    case "toBeChecked":
      return `${expectation.matcher}()`;
    case "toHaveAttribute":
      return `toHaveAttribute(${str(expectation.name)}, ${matcherToSource(expectation.expected)})`;
    case "toHaveCSS":
      return `toHaveCSS(${str(expectation.name)}, ${matcherToSource(expectation.expected)})`;
    case "toHaveCount":
      return `toHaveCount(${expectation.expected})`;
    default:
      return `${expectation.matcher}(${matcherToSource(expectation.expected)})`;
  }
}

/** The statement for a step, on one line */
export function stepToSource(step: Step): string {
  switch (step.kind) {
    case "goto":
      return `await page.goto(${str(step.url)});`;
    case "click":
      return `await ${locatorToSource(step.locator)}.click();`;
    case "fill":
      return `await ${locatorToSource(step.locator)}.fill(${valueToSource(step.value)});`;
    case "press":
      return `await ${locatorToSource(step.locator)}.press(${str(step.key)});`;
    case "expect":
      return `await expect(${locatorToSource(step.locator)})${step.not ? ".not" : ""}.${expectationToSource(step.expectation)};`;
    case "expectPage":
      return `await expect(page)${step.not ? ".not" : ""}.${expectationToSource(step.expectation)};`;
    case "waitForNetworkIdle":
      return "await page.waitForNetworkIdle();";
    case "waitForTimeout":
      return `await page.waitForTimeout(${step.ms});`;
    case "screenshot":
      return `await page.screenshot({ name: ${str(step.name)}${step.fullPage ? ", fullPage: true" : ""} });`;
    case "setInputFiles":
    case "dropFiles":
      return `await ${locatorToSource(step.locator)}.${step.kind}(${filesToSource(step.files)});`;
    case "custom":
      return step.code;
  }
}
