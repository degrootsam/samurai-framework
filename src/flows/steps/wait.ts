import { defineStep } from "./define.js";

export const wait = defineStep({
  kind: "wait",
  label: "Wait",
  icon: "timer",
  section: "control",
  fields: [
    {
      path: "config.ms",
      type: "number",
      label: "Duration",
      unit: "ms",
      default: 1000,
      min: 0,
    },
  ],
  summary: "{config.ms} ms",
  async run({ config, sleep }) {
    await sleep(config.ms);
  },
});
