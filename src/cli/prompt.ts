import { createInterface } from "node:readline";

/** Asks on the terminal when stdin is one; undefined otherwise (a pipe, CI), so a command knows it cannot ask */
export function terminalPrompt():
  ((question: string) => Promise<string>) | undefined {
  if (!process.stdin.isTTY) return undefined;
  return (question) =>
    new Promise((resolve) => {
      const lines = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      lines.question(question, (answer) => {
        lines.close();
        resolve(answer);
      });
    });
}
