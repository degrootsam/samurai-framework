import { defineConfig } from "./src/config/config.js";

export default defineConfig({
  srcDir: "./src/tests",
  browser: "chrome",
  timeout: 30000,
});
