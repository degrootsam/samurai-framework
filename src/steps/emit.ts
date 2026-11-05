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
/** A name that can follow a `.` or stand as an object key unquoted */
export const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `, { a: 1, b: "x" }` from key and source pairs; a pair without source is left out, and so is an empty object */
function optionsToSource(
  pairs: readonly (readonly [string, string | undefined])[],
): string {
  const parts = pairs
    .filter(([, source]) => source !== undefined)
    .map(([key, source]) => `${key}: ${source}`);
  return parts.length ? `, { ${parts.join(", ")} }` : "";
}

/** A string, number or boolean as source, or undefined when it isn't set */
const literal = (value: string | number | boolean | undefined) =>
  value === undefined
    ? undefined
    : typeof value === "string"
      ? str(value)
      : String(value);

const ROLE_OPTIONS = [
  "exact",
  "level",
  "checked",
  "pressed",
  "expanded",
  "selected",
  "disabled",
  "includeHidden",
] as const;

export function callToSource(call: LocatorCall): string {
  switch (call.method) {
    case "locator":
      return `locator(${str(call.xpath)})`;
    case "getByCss":
      return `getByCss(${str(call.css)})`;
    case "getByText":
    case "getByLabel":
      return `${call.method}(${matcherToSource(call.text)}${optionsToSource([
        ["exact", literal(call.exact)],
        ["match", literal(call.match)],
        ["ignoreCase", literal(call.ignoreCase)],
      ])})`;
    case "getByPlaceholder":
    case "getByAltText":
    case "getByTitle":
      return `${call.method}(${matcherToSource(call.text)}${optionsToSource([["exact", literal(call.exact)]])})`;
    case "getByRole":
      return `getByRole(${str(call.role)}${optionsToSource([
        [
          "name",
          call.name === undefined ? undefined : matcherToSource(call.name),
        ],
        ...ROLE_OPTIONS.map((key) => [key, literal(call[key])] as const),
      ])})`;
    case "getByTestId":
      return `getByTestId(${str(call.testId)})`;
    case "nth":
      return `nth(${call.index})`;
    case "first":
    case "last":
      return `${call.method}()`;
    case "filter":
      return `filter({ hasText: ${matcherToSource(call.hasText)} })`;
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
  const object =
    value.kind === "env"
      ? "env"
      : value.kind === "secret"
        ? "secrets"
        : "inputs";
  return IDENTIFIER.test(value.name)
    ? `${object}.${value.name}`
    : `${object}[${str(value.name)}]`;
}

/**
 * A regex literal for a pattern. The source goes through `RegExp`, which escapes a `/` and a line break and leaves
 * text that is already escaped alone, so a pattern typed by hand still makes a literal that compiles.
 */
function regexToSource({ source, flags }: { source: string; flags: string }) {
  let escaped = source;
  try {
    escaped = new RegExp(source, flags).source;
  } catch {
    // Not a valid pattern: written unchanged
  }
  return `/${escaped}/${flags}`;
}

function matcherToSource(expected: TextMatcher): string {
  return typeof expected === "string"
    ? str(expected)
    : regexToSource(expected.regex);
}

/** The `{ output }` option a fill or a check ends with, as its last argument */
const outputOption = (output: string | undefined) =>
  output === undefined ? "" : `, { output: ${str(output)} }`;

function expectationToSource(
  expectation: Expectation | PageExpectation,
  output?: string,
): string {
  const tail = outputOption(output);
  switch (expectation.matcher) {
    case "toBeVisible":
    case "toBeHidden":
    case "toBeEnabled":
    case "toBeChecked":
      return `${expectation.matcher}()`;
    case "toHaveAttribute":
      return `toHaveAttribute(${str(expectation.name)}, ${matcherToSource(expectation.expected)}${tail})`;
    case "toHaveCSS":
      return `toHaveCSS(${str(expectation.name)}, ${matcherToSource(expectation.expected)})`;
    case "toHaveCount":
      return `toHaveCount(${expectation.expected})`;
    default:
      return `${expectation.matcher}(${matcherToSource(expectation.expected)}${tail})`;
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
      return `await ${locatorToSource(step.locator)}.fill(${valueToSource(step.value)}${outputOption(step.output)});`;
    case "press":
      return `await ${locatorToSource(step.locator)}.press(${str(step.key)});`;
    case "expect":
      return `await expect(${locatorToSource(step.locator)})${step.not ? ".not" : ""}.${expectationToSource(step.expectation, step.output)};`;
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
    case "saveOutput":
      return `await outputs.save(${str(step.name)}, ${locatorToSource(step.locator)}${step.pattern ? `, ${regexToSource(step.pattern)}` : ""});`;
    case "custom":
      return step.code;
  }
}
