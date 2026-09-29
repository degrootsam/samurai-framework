import { defineConfig } from "./src/config/config.js";
import { SamuraiGroup } from "./src/types/config.js";

export default defineConfig({
  srcDir: "./src/tests",
  browser: "firefox",
  timeout: 30000,
  groups: [{ browser: "firefox" }],
});
