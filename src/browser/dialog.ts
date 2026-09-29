import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type {
  UserPromptOpenedParameters,
  UserPromptType,
} from "../types/bidi-modules/browsing-context.js";

export interface DialogResult {
  accepted: boolean;
  /** What was typed into a `prompt` */
  userText?: string;
}

/**
 * A JavaScript dialog (`alert`, `confirm`, `prompt`) or a `beforeunload` prompt that is open in the page.
 * Answer it once with `accept()` or `dismiss()`; `page.on("dialog")` hands these out.
 */
export class Dialog {
  /** Resolves when the browser reports the prompt closed */
  public readonly closed: Promise<DialogResult>;
  private resolveClosed!: (result: DialogResult) => void;
  private answered: boolean;

  constructor(
    private connector: BiDiConnector,
    /** The top-level context of the page; prompts are answered there, also when an iframe opened them */
    private context: string,
    private info: UserPromptOpenedParameters,
  ) {
    this.closed = new Promise((resolve) => (this.resolveClosed = resolve));
    // With another handler than "ignore" the browser has answered already
    this.answered = info.handler !== "ignore";
  }

  public type(): UserPromptType {
    return this.info.type;
  }

  public message(): string {
    return this.info.message;
  }

  /** The text a `prompt` starts with; empty for the other kinds */
  public defaultValue(): string {
    return this.info.defaultValue ?? "";
  }

  /** True once the dialog is answered, by you or by the browser */
  public get handled(): boolean {
    return this.answered;
  }

  /** Clicks OK; `promptText` is typed into a `prompt` first */
  public accept(promptText?: string): Promise<void> {
    return this.answer({ accept: true, ...(promptText !== undefined && { userText: promptText }) });
  }

  /** Clicks Cancel */
  public dismiss(): Promise<void> {
    return this.answer({ accept: false });
  }

  /** Called by the page when the browser reports the prompt closed */
  public markClosed(result: DialogResult): void {
    this.answered = true;
    this.resolveClosed(result);
  }

  private async answer(params: { accept: boolean; userText?: string }): Promise<void> {
    if (this.answered) throw new Error("dialog already handled");
    this.answered = true;
    try {
      await this.connector.send("browsingContext.handleUserPrompt", {
        context: this.context,
        ...params,
      });
    } catch (err) {
      // Closed meanwhile (a navigation, another handler): the dialog is gone, which is what was wanted
      if (err instanceof BiDiError && err.code === "no such alert") return;
      throw err;
    }
  }
}
