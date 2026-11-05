import { MASK, maskText } from "../config/mask.js";

/** The last few lines a child process printed, kept for the error message when it fails */
export class OutputTail {
  private lines: string[] = [];
  private partial = "";

  constructor(
    private readonly max = 20,
    /** Values to hide besides the registered secrets (the child's own `env` values) */
    private readonly hidden: readonly string[] = [],
  ) {}

  add(chunk: Buffer | string): void {
    const text = this.partial + chunk.toString();
    const parts = text.split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    this.lines.push(...parts);
    if (this.lines.length > this.max)
      this.lines.splice(0, this.lines.length - this.max);
  }

  /** The kept lines, masked, one per line; empty when the child printed nothing */
  text(): string {
    let text = [...this.lines, this.partial]
      .filter((line) => line !== "")
      .join("\n");
    for (const value of this.hidden)
      if (value.length >= 4) text = text.split(value).join(MASK);
    return maskText(text);
  }
}
