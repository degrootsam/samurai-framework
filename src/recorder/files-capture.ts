// src/recorder/files-capture.ts
import { CANDIDATES_JS } from "./candidates.js";

/** The BiDi sandbox realm the file capture script runs in: page scripts can't reach its listeners or the files it keeps */
export const FILES_SANDBOX = "samurai-files";
/** `Symbol.for(FILES_KEY)` on the sandbox global holds the hook the recorder reads files through */
export const FILES_KEY = "samurai.files";
/** A file is read and sent in pieces of this many bytes */
export const CHUNK_BYTES = 1024 * 1024;

/**
 * Function declaration installed as a preload script in the `samurai-files` sandbox, called as `(send)` with
 * the recorder's files channel. Top-level documents only. Reports:
 *
 * - `{ type: "files", via: "input", target, candidates, files }`: a person changed the files of an
 *   `<input type=file>` (no files: it was cleared).
 * - `{ type: "files", via: "drop", target, candidates, files }`: a person dropped files on `target`.
 * - `{ type: "picker" }`: a file input got a click (the page's `input.click()`, a label, or the input itself),
 *   which opens the file picker.
 * - `{ type: "picker-cancel" }`: the picker was closed without choosing.
 *
 * `files` is `{ id, name, type, size }[]`. The `File` objects stay here, kept by id, until the recorder reads
 * them through `globalThis[Symbol.for("samurai.files")].read(id, offset)` (base64 of up to 1 MB) and calls
 * `release(id)`. A drop's file list can only be read during the event, so it is taken then.
 * Events a person didn't cause (`isTrusted` false) are ignored, unless `trustSynthetic` (tests only).
 * A string, so no transpiler helper can end up in it.
 */
export function filesCaptureSource(
  options: { trustSynthetic?: boolean } = {},
): string {
  return String.raw`(send) => {
  if (window !== window.top) return;
  const KEY = Symbol.for("${FILES_KEY}");
  if (globalThis[KEY]) globalThis[KEY].dispose();

  ${CANDIDATES_JS}

  const TRUST_SYNTHETIC = ${options.trustSynthetic === true};
  const trusted = (event) => event.isTrusted || TRUST_SYNTHETIC;
  const files = new Map();
  let nextId = 1;
  const keep = (list) => Array.from(list || []).map((file) => {
    const id = nextId++;
    files.set(id, file);
    return { id, name: file.name, type: file.type, size: file.size };
  });
  const isFileInput = (el) =>
    el instanceof Element && el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "file";
  const listening = [];
  const listen = (type, handler) => {
    window.addEventListener(type, handler, true);
    listening.push([type, handler]);
  };

  listen("change", (event) => {
    const el = event.target;
    if (!trusted(event) || !isFileInput(el)) return;
    send({ type: "files", via: "input", target: el, candidates: candidatesOf(el), files: keep(el.files) });
  });
  listen("cancel", (event) => {
    if (trusted(event) && isFileInput(event.target)) send({ type: "picker-cancel" });
  });
  // The page opens a picker with input.click(), which is not a trusted click: any click on a file input counts
  listen("click", (event) => {
    if (isFileInput(event.target)) send({ type: "picker" });
  });
  listen("drop", (event) => {
    const el = event.target;
    if (!trusted(event) || inToolbar(event) || !(el instanceof Element)) return;
    const data = event.dataTransfer;
    if (!data || Array.from(data.types || []).indexOf("Files") < 0 || data.files.length === 0) return;
    send({ type: "files", via: "drop", target: el, candidates: candidatesOf(el), files: keep(data.files) });
  });

  // arrayBuffer() hands back a page-realm buffer the sandbox may not read (Xray wrapper); a data URL is a string
  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
  globalThis[KEY] = {
    read: async (id, offset) => {
      const file = files.get(id);
      if (!file) throw new Error("No file " + id);
      return toBase64(file.slice(offset, offset + ${CHUNK_BYTES}));
    },
    release: (id) => { files.delete(id); },
    dispose: () => {
      for (const [type, handler] of listening.splice(0)) window.removeEventListener(type, handler, true);
      files.clear();
      if (globalThis[KEY] && globalThis[KEY].read) delete globalThis[KEY];
    },
  };
}`;
}
