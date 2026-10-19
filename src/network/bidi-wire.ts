import type {
  BytesValue,
  Header,
  RequestData,
} from "../types/bidi-modules/network.js";
import type { NetworkRequest } from "./network-types.js";

/** Header list to a lower-cased record; repeated names are joined, base64 values decoded */
export function headersFromBidi(headers: Header[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { name, value } of headers) {
    const text =
      value.type === "base64"
        ? Buffer.from(value.value, "base64").toString("utf8")
        : value.value;
    const key = name.toLowerCase();
    result[key] = key in result ? `${result[key]}, ${text}` : text;
  }
  return result;
}

/** A record of headers as the list BiDi commands take */
export function headersToBidi(headers: Record<string, string>): Header[] {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: { type: "string", value },
  }));
}

/** A body as BiDi takes it: text as is, bytes as base64 */
export function toBytes(data: string | Buffer): BytesValue {
  return typeof data === "string"
    ? { type: "string", value: data }
    : { type: "base64", value: data.toString("base64") };
}

/** The request a `network.*` event describes */
export function toRequest(
  data: RequestData,
  navigation: string | null,
  isBlocked: boolean,
  redirectedFrom: NetworkRequest | null,
): NetworkRequest {
  return {
    id: data.request,
    url: data.url,
    method: data.method,
    headers: headersFromBidi(data.headers),
    resourceType: data.destination || data.initiatorType || "other",
    navigation,
    redirectedFrom,
    isBlocked,
  };
}
