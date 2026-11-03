/** Whether a locator throws when it matches several elements; asked when an action or read needs its element */
export type StrictSource = () => Promise<boolean>;

/** The default: the first match is used */
export const NOT_STRICT: StrictSource = () => Promise.resolve(false);

/** The error a strict locator throws for an action or read that found several elements */
export function strictViolation(
  method: string,
  count: number,
  selector: string,
): Error {
  return new Error(
    `${method}(): strict mode violation, ${count} elements match ${selector}`,
  );
}
