import { defineNode } from "./define.js";

// The app's editor adds the `continueSession` field (a custom component) to this kind.
export const test = defineNode({
  kind: "test",
  label: "Test",
  shape: "step",
  fields: [],
  outputs: true,
  validate: (node, ctx) =>
    ctx.tests && !(node.ref?.testId && ctx.tests.has(node.ref.testId))
      ? [
          {
            level: "error",
            nodeId: node.id,
            message: `A ${ctx.label.toLowerCase()} in this flow was deleted or moved.`,
          },
        ]
      : [],
});
