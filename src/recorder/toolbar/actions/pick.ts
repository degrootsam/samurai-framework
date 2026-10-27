import { MASK } from "../../../config/mask.js";
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

/** A text with every secret value it holds replaced by the mask, longest value first (as `holdsSecret` finds them) */
export function maskSecrets(
  secrets: Map<string, string | undefined>,
): (text: string) => string {
  const values = [...secrets.values()]
    .filter((value): value is string => value !== undefined && value !== "")
    .sort((a, b) => b.length - a.length);
  return (text) =>
    values.reduce((masked, value) => masked.split(value).join(MASK), text);
}

/**
 * A field may hold an inserted secret: its value (and any text, attribute, class or CSS value holding a secret) is left out,
 * the output text has the secret masked (Save as output previews on the recorder's side then, see `outputPreview`),
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
    !secret(info.outputText) &&
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
    outputText: maskSecrets(secrets)(info.outputText),
    ...(secret(info.outputText) && { showsSecret: true as const }),
    attributes: info.attributes.filter((a) => !secret(a.value)),
    className: secret(info.className ?? undefined) ? null : info.className,
    css: secret(info.css.value) ? { ...info.css, value: "" } : info.css,
    first: {
      matcher: first.matcher,
      ...("expected" in first && { expected: String(first.expected) }),
    },
  };
}
