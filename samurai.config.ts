import { defineConfig } from "./src/config/config.js";

export default defineConfig({
  srcDir: "./src/tests",
  browsers: ["firefox"],
  timeout: 30000,
});
