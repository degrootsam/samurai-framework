export { parseSpec } from "./parse.js";
export { applyEdit, type StepEdit } from "./edit.js";
export {
  stepToSource,
  locatorToSource,
  callToSource,
  valueToSource,
} from "./emit.js";
export { locatorFromSpec } from "./build.js";
export type {
  Expectation,
  LocatorCall,
  LocatorSpec,
  ParsedStep,
  ParsedTest,
  Step,
  TextMatcher,
  TextValue,
} from "./model.js";
