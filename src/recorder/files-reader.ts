// src/recorder/files-reader.ts
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { CHUNK_BYTES, FILES_KEY, FILES_SANDBOX } from "./files-capture.js";

const HOOK = `globalThis[Symbol.for(${JSON.stringify(FILES_KEY)})]`;

/** Reads a file the capture script kept, `CHUNK_BYTES` at a time, handing each piece to `onChunk` in order */
export async function readPageFile(
  connector: BiDiConnector,
  context: string,
  id: number,
  size: number,
  onChunk: (bytes: Buffer) => unknown,
): Promise<void> {
  for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
    const base64 = await callFunction<string>(
      connector,
      context,
      `(id, offset) => ${HOOK}.read(id, offset)`,
      [id, offset],
      { sandbox: FILES_SANDBOX },
    );
    await onChunk(Buffer.from(base64, "base64"));
  }
}

/** Lets the capture script drop its reference to a file */
export async function releasePageFile(
  connector: BiDiConnector,
  context: string,
  id: number,
): Promise<void> {
  await callFunction(
    connector,
    context,
    `(id) => { ${HOOK}?.release(id); }`,
    [id],
    {
      sandbox: FILES_SANDBOX,
      awaitPromise: false,
    },
  );
}

/** Takes the capture script's listeners off the loaded document (the recording ended) */
export async function disposeFilesCapture(
  connector: BiDiConnector,
  context: string,
): Promise<void> {
  await callFunction(connector, context, `() => { ${HOOK}?.dispose(); }`, [], {
    sandbox: FILES_SANDBOX,
    awaitPromise: false,
  });
}
