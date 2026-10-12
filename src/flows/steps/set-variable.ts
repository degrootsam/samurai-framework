import { defineStep } from "./define.js";

export const setVariable = defineStep({
  kind: "set-variable",
  label: "Set variable",
  icon: "braces",
  section: "control",
  fields: [
    {
      path: "config.name",
      type: "text",
      label: "Name",
      placeholder: "orderId",
      default: "",
      required: true,
      pattern: "^[a-z][a-z0-9_]*$",
      patternMessage: "use lowercase letters, digits and _ for the name.",
    },
    {
      path: "config.value",
      type: "expression",
      label: "Value",
      placeholder: '"order-" + run.environment',
      default: "",
    },
  ],
  summary: "vars.{config.name} = {config.value}",
  writesVar: "config.name",
  async run({ config }) {
    return { vars: { [config.name]: config.value } };
  },
});
