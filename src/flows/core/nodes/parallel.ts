import { defineNode } from "./define.js";

// Every branch leads on to the node after the Parallel. Branches are dropped
// onto one at a time: the list is always its filled branches plus one empty.
export const parallel = defineNode({
  kind: "parallel",
  label: "Parallel",
  shape: "branches",
  branches: { dynamic: true, min: 2 },
  fields: [],
  onFailure: true,
});
