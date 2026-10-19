import { expectationFor } from "../../expectation.js";
import type { PickInfo } from "../protocol.js";

/**
 * A field may hold an inserted secret: its value (and any text or attribute equal to a secret) is left out,
 * and the first matcher follows the Alt+click rule without a value, so neither the page nor the spec gets it.
 */
export function withoutSecrets(
  info: PickInfo & { ok: true },
  secrets: Map<string, string | undefined>,
): PickInfo {
  const values = [...secrets.values()].filter(
    (value): value is string => value !== undefined && value !== "",
  );
  const secret = (text: string | undefined) =>
    text !== undefined && values.some((value) => text.includes(value));
  if (
    !secret(info.value) &&
    !secret(info.text) &&
    !secret(info.first.expected) &&
    !info.attributes.some((a) => secret(a.value))
  )
    return info;
  const text = secret(info.text) ? "" : info.text;
  const first = expectationFor(text, undefined);
  const { value: _value, ...rest } = info;
  return {
    ...rest,
    text,
    attributes: info.attributes.filter((a) => !secret(a.value)),
    first: {
      matcher: first.matcher,
      ...("expected" in first && { expected: String(first.expected) }),
    },
  };
}
