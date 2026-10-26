import { expectationFor } from "../../expectation.js";
import type { PickInfo } from "../protocol.js";

/** Whether a text holds the value of one of the secrets */
export function holdsSecret(
  secrets: Map<string, string | undefined>,
): (text: string | undefined) => boolean {
  const values = [...secrets.values()].filter(
    (value): value is string => value !== undefined && value !== "",
  );
  return (text) =>
    text !== undefined && values.some((value) => text.includes(value));
}

/**
 * A field may hold an inserted secret: its value (and any text, attribute, class or CSS value holding a secret) is left out,
 * and the first matcher follows the Alt+click rule without a value, so neither the page nor the spec gets it.
 */
export function withoutSecrets(
  info: PickInfo & { ok: true },
  secrets: Map<string, string | undefined>,
): PickInfo {
  const secret = holdsSecret(secrets);
  if (
    !secret(info.value) &&
    !secret(info.text) &&
    !secret(info.first.expected) &&
    !secret(info.className ?? undefined) &&
    !secret(info.css.value) &&
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
    className: secret(info.className ?? undefined) ? null : info.className,
    css: secret(info.css.value) ? { ...info.css, value: "" } : info.css,
    first: {
      matcher: first.matcher,
      ...("expected" in first && { expected: String(first.expected) }),
    },
  };
}
