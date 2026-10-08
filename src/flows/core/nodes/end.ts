import { defineNode } from "./define.js";

export const end = defineNode({
  kind: "end",
  label: "End",
  shape: "end",
  fields: [],
});
