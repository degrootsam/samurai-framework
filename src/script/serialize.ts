import type {
  ArgumentValue,
  RemoteValue,
} from "../types/bidi-modules/script.js";
import { ElementHandle } from "./element-handle.js";

/** A value passed to a page function */
export type Arg = unknown;

/** Deepest nesting `toLocalValue` accepts; a second guard next to cycle detection */
const MAX_DEPTH = 100;

/** A remote value that cannot be copied to plain JS (function, window, promise, …), kept by type and handle */
export class RemoteObject {
  constructor(
    public readonly type: string,
    public readonly handle?: string,
    /** The deserialized value, when the browser sent one and handles were kept */
    public readonly value?: unknown,
  ) {}
}

/**
 * A channel the page function can call as `send(value)`; the browser delivers each value as a
 * `script.message` event. Only meaningful as a preload script or function argument.
 */
export class ChannelArg {
  constructor(public readonly channel: string) {}
}

/** Serializes `value` for `script.callFunction` arguments; throws TypeError for what cannot cross the wire */
export function toLocalValue(value: Arg): ArgumentValue {
  return serialize(value, new Set(), 0);
}

function serialize(value: unknown, ancestors: Set<object>, depth: number): ArgumentValue {
  if (depth > MAX_DEPTH) throw new TypeError("cannot serialize a value that is too deeply nested");

  switch (typeof value) {
    case "undefined":
      return { type: "undefined" };
    case "boolean":
      return { type: "boolean", value };
    case "string":
      return { type: "string", value };
    case "number":
      return { type: "number", value: numberValue(value) };
    case "bigint":
      return { type: "bigint", value: value.toString() };
    case "function":
    case "symbol":
      throw new TypeError(`cannot serialize ${typeof value}`);
  }

  if (value === null) return { type: "null" };
  if (value instanceof ChannelArg) {
    // Nodes arrive as references only, which is all the recorder needs
    return {
      type: "channel",
      value: { channel: value.channel, serializationOptions: { maxDomDepth: 0, maxObjectDepth: 4 }, ownership: "none" },
    };
  }
  if (value instanceof ElementHandle) {
    return value.handle === undefined
      ? { sharedId: value.sharedId }
      : { sharedId: value.sharedId, handle: value.handle };
  }
  if (value instanceof Date) return { type: "date", value: value.toISOString() };
  if (value instanceof RegExp) {
    return { type: "regexp", value: { pattern: value.source, flags: value.flags } };
  }

  const object = value as object;
  if (ancestors.has(object)) throw new TypeError("cannot serialize a circular structure");
  ancestors.add(object);
  try {
    const next = (item: unknown) => serialize(item, ancestors, depth + 1);
    if (Array.isArray(object)) return { type: "array", value: object.map(next) };
    if (object instanceof Set) return { type: "set", value: [...object].map(next) };
    if (object instanceof Map) {
      return {
        type: "map",
        value: [...object].map(([key, item]) => [
          typeof key === "string" ? key : next(key),
          next(item),
        ]),
      };
    }
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`cannot serialize ${prototype.constructor?.name ?? "object"}`);
    }
    return {
      type: "object",
      value: Object.entries(object).map(([key, item]) => [key, next(item)]),
    };
  } finally {
    ancestors.delete(object);
  }
}

function numberValue(value: number): number | string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return value;
}

export interface DeserializeOptions {
  /** Return objects that carry a handle as `RemoteObject`s (with `.value`), so the caller can disown them later */
  keepHandles?: boolean;
}

/** Converts a remote value to plain JS; what cannot be copied becomes a `RemoteObject` */
export function fromRemoteValue(value: RemoteValue, options: DeserializeOptions = {}): unknown {
  return deserialize(value, new Map(), options);
}

function deserialize(
  value: RemoteValue,
  known: Map<string, unknown>,
  options: DeserializeOptions,
): unknown {
  const loose = value as RemoteValue & {
    value?: unknown;
    handle?: string;
    internalId?: string;
    sharedId?: string;
  };

  switch (value.type) {
    case "undefined":
      return undefined;
    case "null":
      return null;
    case "string":
    case "boolean":
      return value.value;
    case "number":
      return specialNumber(value.value);
    case "bigint":
      return BigInt(value.value);
    case "date":
      return new Date(value.value);
    case "regexp": {
      const { pattern, flags } = loose.value as { pattern: string; flags?: string };
      return new RegExp(pattern, flags);
    }
    case "node":
      return new ElementHandle(loose.sharedId ?? "", loose.handle);
  }

  const nested = (item: RemoteValue) => deserialize(item, known, options);
  const remember = <T>(result: T): T => {
    if (loose.internalId !== undefined) known.set(loose.internalId, result);
    return result;
  };
  const backReference = () =>
    loose.internalId !== undefined && known.has(loose.internalId)
      ? { found: true as const, value: known.get(loose.internalId) }
      : undefined;

  let result: unknown;
  switch (value.type) {
    case "array":
    case "set":
    case "object":
    case "map": {
      const reference = backReference();
      if (reference && loose.value === undefined) return reference.value;
      if (loose.value === undefined) break; // cut off by the serialization depth
      if (value.type === "array") {
        const list: unknown[] = remember([]);
        (loose.value as RemoteValue[]).forEach((item) => list.push(nested(item)));
        result = list;
      } else if (value.type === "set") {
        const set = remember(new Set<unknown>());
        (loose.value as RemoteValue[]).forEach((item) => set.add(nested(item)));
        result = set;
      } else {
        const entries = loose.value as Array<[RemoteValue | string, RemoteValue]>;
        const key = (raw: RemoteValue | string) =>
          typeof raw === "string" ? raw : nested(raw);
        if (value.type === "map") {
          const map = remember(new Map<unknown, unknown>());
          entries.forEach(([k, item]) => map.set(key(k), nested(item)));
          result = map;
        } else {
          const object: Record<string, unknown> = remember({});
          entries.forEach(([k, item]) => {
            object[String(key(k))] = nested(item);
          });
          result = object;
        }
      }
      return options.keepHandles && loose.handle !== undefined
        ? new RemoteObject(value.type, loose.handle, result)
        : result;
    }
  }
  return new RemoteObject(value.type, loose.handle);
}

function specialNumber(value: number | string): number {
  switch (value) {
    case "NaN":
      return NaN;
    case "Infinity":
      return Infinity;
    case "-Infinity":
      return -Infinity;
    case "-0":
      return -0;
    default:
      return Number(value);
  }
}
