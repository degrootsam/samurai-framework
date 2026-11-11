import type { RegisteredTestCase } from "../types/test.js";
import { newSuite } from "../runner/suite.js";

export const testCase = (file: string, name: string): RegisteredTestCase => ({
  file,
  name,
  titlePath: name.split(" > "),
  suite: newSuite(),
  function: async () => {},
});
