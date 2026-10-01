import type { EmptyResult } from "../bidi.js";
import type { UserContext } from "./browser.js";

/** Commands available in the WebDriver BiDi permissions module. */
export interface PermissionsCommands {
  /** Grants, denies or resets a permission for an origin (in one user context, or the default one). */
  "permissions.setPermission": {
    params: {
      descriptor: { name: string };
      state: PermissionState;
      origin: string;
      embeddedOrigin?: string | undefined;
      userContext?: UserContext | undefined;
    };
    result: EmptyResult;
  };
}

export type PermissionState = "granted" | "denied" | "prompt";
