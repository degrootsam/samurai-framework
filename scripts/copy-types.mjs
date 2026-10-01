// tsc does not copy the hand-written .d.ts files (the BiDi typings), which the emitted declarations import
import { cpSync } from "node:fs";

cpSync("src/types", "dist/types", {
  recursive: true,
  filter: (source) => !source.endsWith(".ts") || source.endsWith(".d.ts"),
});
