import type {
  ArgumentValue,
  RemoteValue,
} from "../types/bidi-modules/script.js";
import { ElementHandle } from "./element-handle.js";

/** A value passed to a page function */
export type Arg = unknown;

/** Deepest nesting `toLocalValue` accepts; a second guard next to cycle detection */
const MAX_DEPTH = 100;

/** A remote value that cannot be copied to plain JS (function, window, promise, …), kept by its type */
export class RemoteObject {
  constructor(public readonly type: string) {}
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

function serialize(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
): ArgumentValue {
  if (depth > MAX_DEPTH)
    throw new TypeError("cannot serialize a value that is too deeply nested");

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
      value: {
        channel: value.channel,
        serializationOptions: { maxDomDepth: 0, maxObjectDepth: 4 },
        ownership: "none",
      },
    };
  }
  if (value instanceof ElementHandle) return { sharedId: value.sharedId };
  if (value instanceof Date)
    return { type: "date", value: value.toISOString() };
  if (value instanceof RegExp) {
    return {
      type: "regexp",
      value: { pattern: value.source, flags: value.flags },
    };
  }

  const object = value as object;
  if (ancestors.has(object))
    throw new TypeError("cannot serialize a circular structure");
  ancestors.add(object);
  try {
    const next = (item: unknown) => serialize(item, ancestors, depth + 1);
    if (Array.isArray(object))
      return { type: "array", value: object.map(next) };
    if (object instanceof Set)
      return { type: "set", value: [...object].map(next) };
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
      throw new TypeError(
        `cannot serialize ${prototype.constructor?.name ?? "object"}`,
      );
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

/** Converts a remote value to plain JS; what cannot be copied becomes a `RemoteObject` */
export function fromRemoteValue(value: RemoteValue): unknown {
  return deserialize(value, new Map());
}

function deserialize(value: RemoteValue, known: Map<string, unknown>): unknown {
  const loose = value as RemoteValue & {
    value?: unknown;
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
      const { pattern, flags } = loose.value as {
        pattern: string;
        flags?: string;
      };
      return new RegExp(pattern, flags);
    }
    case "node":
      return new ElementHandle(loose.sharedId ?? "");
    case "array":
    case "set":
    case "object":
    case "map":
      // A collection cut off by the serialization depth has no copy to make
      return (
        deserializeCollection(value, known) ?? new RemoteObject(value.type)
      );
  }
  return new RemoteObject(value.type);
}

type RemoteEntries = Array<[RemoteValue | string, RemoteValue]>;

/**
 * An array, set, map or object. A back reference (a value seen before, by `internalId`) gives the copy made
 * earlier; `undefined` means the browser cut the collection off.
 */
function deserializeCollection(
  value: RemoteValue,
  known: Map<string, unknown>,
): unknown {
  const { value: items, internalId } = value as RemoteValue & {
    value?: unknown;
    internalId?: string;
  };
  if (items === undefined)
    return internalId !== undefined && known.has(internalId)
      ? known.get(internalId)
      : undefined;
  // Registered before the items are read, so an item that points back at its container finds it
  const remember = <T>(copy: T): T => {
    if (internalId !== undefined) known.set(internalId, copy);
    return copy;
  };
  const nested = (item: RemoteValue) => deserialize(item, known);
  const key = (raw: RemoteValue | string) =>
    typeof raw === "string" ? raw : nested(raw);

  switch (value.type) {
    case "array": {
      const list: unknown[] = remember([]);
      (items as RemoteValue[]).forEach((item) => list.push(nested(item)));
      return list;
    }
    case "set": {
      const set = remember(new Set<unknown>());
      (items as RemoteValue[]).forEach((item) => set.add(nested(item)));
      return set;
    }
    case "map": {
      const map = remember(new Map<unknown, unknown>());
      (items as RemoteEntries).forEach(([k, item]) =>
        map.set(key(k), nested(item)),
      );
      return map;
    }
    default: {
      const object: Record<string, unknown> = remember({});
      (items as RemoteEntries).forEach(([k, item]) => {
        object[String(key(k))] = nested(item);
      });
      return object;
    }
  }
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
