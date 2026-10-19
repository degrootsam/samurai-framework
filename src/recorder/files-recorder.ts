import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import logger from "../logger/index.js";
import {
  cleanFileName,
  filesFolder,
  RECORD_LIMIT,
  storeFile,
} from "../project/index.js";
import { humanSize } from "../steps/files.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { readPageFile, releasePageFile } from "./files-reader.js";
import type { FileRecording, MissingFile } from "./options.js";

/** The warning for a file that isn't saved, as the toolbar and the CLI show it */
export function missingFileText(file: MissingFile, folder: string): string {
  const where = folder === "" ? "the project folder" : `${folder}/`;
  return file.reason === "too-big"
    ? `${file.name} is ${humanSize(file.size)}. Files over 50 MB aren't saved: add it to ${where} yourself, or use a generated file.`
    : `${file.name} couldn't be read, so it isn't saved: add it to ${where} yourself, or use a generated file.`;
}

/** What `FilesRecorder` tells the toolbar, when there is one */
export interface FilesNotices {
  warn(text: string): void;
  /** A file is being saved; `undefined` when done */
  saving(name: string | undefined): void;
}

/** Saves the files a person picked or dropped into the project's files folder and keeps count of what was and was not saved */
export class FilesRecorder {
  private readonly stored = new Set<string>();
  private readonly missing: MissingFile[] = [];

  constructor(
    private readonly connector: BiDiConnector,
    private readonly context: string,
    private readonly recording: FileRecording,
    private readonly notices: FilesNotices,
  ) {}

  /** Files stored or reused in the files folder by this recording, project-relative */
  public get storedFiles(): string[] {
    return [...this.stored];
  }

  /** Files whose steps point at a path that wasn't written */
  public get missingFiles(): MissingFile[] {
    return [...this.missing];
  }

  /** Saves one kept file to the files folder; returns the path its step gets */
  public async store(file: {
    id: number;
    name: string;
    size: number;
  }): Promise<string> {
    const recording = this.recording;
    const folder = filesFolder(recording.projectDir, recording.filesDir);
    const notSaved = (reason: MissingFile["reason"]) => {
      const clean = cleanFileName(file.name);
      const missing: MissingFile = {
        path: folder.relative ? `${folder.relative}/${clean}` : clean,
        name: file.name,
        size: file.size,
        reason,
      };
      this.missing.push(missing);
      recording.onMissing?.(missing);
      this.notices.warn(missingFileText(missing, folder.relative));
      return missing.path;
    };
    if (file.size > RECORD_LIMIT) {
      await releasePageFile(this.connector, this.context, file.id).catch(
        () => undefined,
      );
      return notSaved("too-big");
    }
    this.notices.saving(file.name);
    let temp: string | undefined;
    try {
      temp = await mkdtemp(path.join(tmpdir(), "samurai-upload-"));
      const content = path.join(temp, "content");
      const out = await open(content, "w");
      try {
        await readPageFile(
          this.connector,
          this.context,
          file.id,
          file.size,
          (bytes) => out.write(bytes),
        );
      } finally {
        await out.close();
      }
      const stored = await storeFile({
        projectDir: recording.projectDir,
        ...(recording.filesDir !== undefined && {
          filesDir: recording.filesDir,
        }),
        name: file.name,
        content,
      });
      this.stored.add(stored.path);
      return stored.path;
    } catch (err) {
      logger.warn("Recorder could not save %s", file.name, { err });
      return notSaved("unreadable");
    } finally {
      this.notices.saving(undefined);
      if (temp)
        await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      await releasePageFile(this.connector, this.context, file.id).catch(
        () => undefined,
      );
    }
  }
}
