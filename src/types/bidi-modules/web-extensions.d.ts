import type { EmptyResult } from "../bidi.js";

export type WebExtensionResult = InstallResult | UninstallResult;

export type UninstallResult = EmptyResult;
export type Extension = string;
export interface InstallResult {
  extension: Extension;
}
