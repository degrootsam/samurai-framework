import ts from "typescript";

export function stringOf(node: ts.Node | undefined): string | undefined {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** `true` or `false` */
export function booleanOf(node: ts.Node | undefined): boolean | undefined {
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** An integer literal, with a `-` in front when negative */
export function integerOf(node: ts.Node | undefined): number | undefined {
  if (!node) return undefined;
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    return Number.isInteger(value) ? value : undefined;
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    const value = integerOf(node.operand);
    return value === undefined || value === 0 ? undefined : -value;
  }
  return undefined;
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

/**
 * The values of `{ key: value, … }` as expressions, by key, or undefined when the object has a key that isn't
 * allowed or isn't a plain name, a spread, a shorthand or a key twice
 */
export function readProps(
  node: ts.Node | undefined,
  allowed: readonly string[],
): Record<string, ts.Expression> | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  const props: Record<string, ts.Expression> = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name))
      return undefined;
    const name = property.name.text;
    if (!allowed.includes(name) || name in props) return undefined;
    props[name] = property.initializer;
  }
  return props;
}
