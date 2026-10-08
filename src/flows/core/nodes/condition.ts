import { defineNode } from "./define.js";

export const condition = defineNode({
  kind: "condition",
  label: "Condition",
  shape: "branches",
  branches: [
    { name: "true", label: "true", color: "success" },
    { name: "false", label: "false", color: "error" },
  ],
  fields: [
    {
      path: "config.expr",
      type: "expression",
      label: "Expression",
      placeholder: 'nodes.login.status == "passed"',
      default: "",
    },
  ],
  outputs: true,
  onFailure: true,
});
