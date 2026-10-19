import ts from "typescript";

export function stringOf(node: ts.Node | undefined): string | undefined {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** `{ key: literal, … }` with only the allowed keys, or undefined when it has anything else */
export function readObject(
  node: ts.Node | undefined,
  allowed: readonly string[],
): Record<string, string | boolean> | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  const result: Record<string, string | boolean> = {};
  for (const property of node.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !allowed.includes(property.name.getText())
    )
      return undefined;
    const value = stringOf(property.initializer);
    if (value !== undefined) result[property.name.getText()] = value;
    else if (property.initializer.kind === ts.SyntaxKind.TrueKeyword)
      result[property.name.getText()] = true;
    else if (property.initializer.kind === ts.SyntaxKind.FalseKeyword)
      result[property.name.getText()] = false;
    else return undefined;
  }
  return result;
}
