import { defineNode } from "./define.js";

export const wait = defineNode({
  kind: "wait",
  label: "Wait",
  shape: "step",
  fields: [
    { path: "title", type: "text", label: "Title" },
    { path: "subtitle", type: "text", label: "Description" },
    {
      path: "config.ms",
      type: "number",
      label: "Duration",
      unit: "ms",
      default: 1000,
    },
  ],
  outputs: true,
});
