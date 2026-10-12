import { defineStep } from "./define.js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ label: m, value: m }));

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** Any response passes and outputs its status; a network error or a bad URL fails the node */
export const api = defineStep({
  kind: "api",
  label: "HTTP request",
  icon: "globe",
  section: "integrations",
  fields: [
    { path: "config.method", type: "select", label: "Method", options: METHODS, default: "GET" },
    { path: "config.url", type: "expression", label: "URL", placeholder: 'env.baseUrl + "/health"', default: "" },
    { path: "config.body", type: "code", label: "Body", placeholder: '{ "name": "test" }', default: "" },
  ],
  summary: "{config.method} {config.url}",
  outputs: [
    { name: "statusCode", label: "Status code" },
    { name: "body", label: "Response body" },
  ],
  async run({ config, signal }) {
    const body = config.method !== "GET" && config.body ? config.body : undefined;
    const res = await fetch(String(config.url), {
      method: config.method,
      signal,
      ...(body !== undefined && {
        body,
        headers: { "content-type": isJson(body) ? "application/json" : "text/plain" },
      }),
    });
    return { outputs: { statusCode: res.status, body: await res.text() } };
  },
});
