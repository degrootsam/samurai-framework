import { defineNode } from "./define.js";

// The app's editor adds the `continueSession` field (a custom component) to this kind.
export const group = defineNode({
  kind: "group",
  label: "Group",
  shape: "step",
  fields: [{ path: "ref.group", type: "group", label: "Group" }],
  outputs: true,
  validate: (node, ctx) =>
    ctx.groups && !(node.ref?.group && ctx.groups.has(node.ref.group))
      ? [
          {
            level: "error",
            nodeId: node.id,
            message: `The ${ctx.label.toLowerCase()} ${node.ref?.group ?? ""} no longer exists.`,
          },
        ]
      : [],
});
