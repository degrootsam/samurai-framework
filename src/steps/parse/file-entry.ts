import ts from "typescript";
import { parseSize } from "../files.js";
import type { FileEntry } from "../model.js";
import { stringOf } from "./literals.js";

/** `"path"` or `generatedFile({ name, size, type? })`; undefined for anything else */
function readFileEntry(node: ts.Expression): FileEntry | undefined {
  const path = stringOf(node);
  if (path !== undefined) return { path };
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "generatedFile" ||
    node.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(node.arguments[0]!)
  )
    return undefined;
  let name: string | undefined;
  let type: string | undefined;
  let size: number | undefined;
  let sizeSource: string | undefined;
  for (const property of node.arguments[0].properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const value = property.initializer;
    switch (property.name.getText()) {
      case "name":
        name = stringOf(value);
        if (name === undefined) return undefined;
        break;
      case "type":
        type = stringOf(value);
        if (type === undefined) return undefined;
        break;
      case "size": {
        const text = stringOf(value);
        size =
          text !== undefined
            ? parseSize(text)
            : ts.isNumericLiteral(value)
              ? parseSize(Number(value.text))
              : undefined;
        if (size === undefined) return undefined;
        sizeSource = value.getText();
        break;
      }
      default:
        return undefined;
    }
  }
  if (name === undefined || size === undefined) return undefined;
  return {
    generate: {
      name,
      size,
      ...(type !== undefined && { type }),
      ...(sizeSource !== undefined && { sizeSource }),
    },
  };
}

/** One file entry, or an array of them */
export function readFiles(
  node: ts.Expression | undefined,
): FileEntry[] | undefined {
  if (!node) return undefined;
  if (ts.isArrayLiteralExpression(node)) {
    const entries = node.elements.map(readFileEntry);
    return entries.every((entry) => entry !== undefined)
      ? (entries as FileEntry[])
      : undefined;
  }
  const entry = readFileEntry(node);
  return entry && [entry];
}
