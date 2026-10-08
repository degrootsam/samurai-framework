/**
 * The pure half of flows: the file format, keys, graph helpers and the expression language.
 * No Node APIs, so a browser bundle (the SAMURAI app's renderer) can import it.
 */
export * from "./schema.js";
export * from "./keys.js";
export * from "./graph.js";
export * from "./expression/index.js";
export * from "./nodes/index.js";
export * from "./check.js";

/**
 * Version of the contract between the SAMURAI app and this framework.
 * Increments whenever the app and the framework must agree on something new
 * (a node kind, a field, an event), so the app can tell when the framework is too old.
 */
export const FLOWS_API = 1;
