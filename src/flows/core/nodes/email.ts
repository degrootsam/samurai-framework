import { defineNode } from "./define.js";

// Declared so flows can hold it; no handler runs it yet (unsupported).
export const email = defineNode({
  kind: "email",
  label: "Email inbox",
  shape: "step",
  fields: [
    { path: "title", type: "text", label: "Title" },
    { path: "subtitle", type: "text", label: "Description" },
  ],
  outputs: true,
});
