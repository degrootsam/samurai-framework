import { cleanName } from "../../browser/evidence.js";

/**
 * The folder a flow node's screenshots go in, relative to `runFlowInProject`'s `outputDir`, with `/` separators:
 * `nodes/` and the node id cleaned for a file name. A node's screenshot paths are relative to this folder.
 */
export function nodeFolder(nodeId: string): string {
  return `nodes/${cleanName(nodeId)}`;
}
