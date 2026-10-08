import { defineNode } from "./define.js";

export const setVariable = defineNode({
  kind: "set-variable",
  label: "Set variable",
  shape: "step",
  fields: [
    {
      path: "config.name",
      type: "text",
      label: "Name",
      placeholder: "orderId",
      default: "",
    },
    {
      path: "config.value",
      type: "expression",
      label: "Value",
      placeholder: '"order-" + run.environment',
      default: "",
    },
  ],
  validate: (node, ctx) =>
    node.config.name === ""
      ? [
          {
            level: "error",
            nodeId: node.id,
            message: `${ctx.label}: give the variable a name.`,
          },
        ]
      : /^[a-z][a-z0-9_]*$/.test(node.config.name)
        ? []
        : [
            {
              level: "error",
              nodeId: node.id,
              message: `${ctx.label}: use lowercase letters, digits and _ for the name.`,
            },
          ],
});
