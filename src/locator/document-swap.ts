import { BiDiError } from "../transport/bidi-error.js";

/**
 * Chrome answers a command sent while the page swaps documents with an unknown error that says the context
 * is gone for the moment; the same call a moment later works.
 */
const DOCUMENT_SWAP =
  /Cannot find context with specified id|execution contexts? (was |were )?(cleared|destroyed)/i;

export function isDocumentSwap(err: unknown): boolean {
  return (
    err instanceof BiDiError &&
    err.code === "unknown error" &&
    DOCUMENT_SWAP.test(err.message)
  );
}
