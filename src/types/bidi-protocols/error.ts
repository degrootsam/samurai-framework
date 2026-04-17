export type ErrorCode =
  | "invalid argument"
  | "invalid selector"
  | "invalid session id"
  | "invalid web extension"
  | "move target out of bounds"
  | "no such alert"
  | "no such network collector"
  | "no such element"
  | "no such frame"
  | "no such handle"
  | "no such history entry"
  | "no such intercept"
  | "no such network data"
  | "no such node"
  | "no such request"
  | "no such script"
  | "no such storage partition"
  | "no such user context"
  | "no such web extension"
  | "session not created"
  | "unable to capture screen"
  | "unable to close browser"
  | "unable to set cookie"
  | "unable to set file input"
  | "unavailable network data"
  | "underspecified storage partition"
  | "unknown command"
  | "unknown error"
  | "unsupported operation";

export interface ErrorResponse {
  type: "error";
  id: number | null;
  error: ErrorCode;
  message: string;
  stacktrace?: string;
}
