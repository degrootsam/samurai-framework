import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readFlowFile, type FlowFile } from "../core/index.js";

export const FLOW_SUFFIX = ".flow.json";

/** The folder a project keeps its flows in */
export const flowsDir = (projectDir: string) =>
  path.join(path.resolve(projectDir), "flows");

/** The ids of the project's flows (file name without `.flow.json`), sorted. Other files are ignored; no folder means no flows. */
export async function listFlows(projectDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(flowsDir(projectDir));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return names
    .filter((n) => n.endsWith(FLOW_SUFFIX) && n.length > FLOW_SUFFIX.length)
    .map((n) => n.slice(0, -FLOW_SUFFIX.length))
    .sort();
}

/** Reads `<project>/flows/<id>.flow.json`; the flow's `id` is the file name, whatever the file says */
export async function readFlow(
  projectDir: string,
  id: string,
): Promise<FlowFile> {
  if (!id || /[\\/]/.test(id) || id.startsWith("."))
    throw new Error(`"${id}" isn't a valid flow id.`);
  const file = path.join(flowsDir(projectDir), `${id}${FLOW_SUFFIX}`);
  return readFlowPath(file, id);
}

/** Reads a `.flow.json` file by its path; the flow's `id` is `id`, else the file name without the suffix */
export async function readFlowPath(
  file: string,
  id = path.basename(file).replace(/\.flow\.json$/, ""),
): Promise<FlowFile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`No flow "${id}": ${file} doesn't exist.`);
    throw new Error(
      `Couldn't read the flow "${id}" (${file}): ${(e as Error).message}`,
    );
  }
  try {
    return { ...readFlowFile(JSON.parse(text)), id };
  } catch (e) {
    throw new Error(
      `Couldn't read the flow "${id}" (${file}): ${(e as Error).message}`,
    );
  }
}

/** Reads every flow of the project, in id order; one that can't be read throws */
export async function readFlows(projectDir: string): Promise<FlowFile[]> {
  const flows: FlowFile[] = [];
  for (const id of await listFlows(projectDir))
    flows.push(await readFlow(projectDir, id));
  return flows;
}
