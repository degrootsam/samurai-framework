// Compile-time check, run by `tsc --noEmit`: every command the BiDi specs rely on is typed.
import type { BiDiCommands } from "./bidi.js";

type Expect<T extends true> = T;
type HasCommand<M extends string> = M extends keyof BiDiCommands
  ? BiDiCommands[M] extends { params: unknown; result: unknown }
    ? true
    : false
  : false;

type Commands = [
  Expect<HasCommand<"script.callFunction">>,
  Expect<HasCommand<"script.disown">>,
  Expect<HasCommand<"script.addPreloadScript">>,
  Expect<HasCommand<"script.removePreloadScript">>,
  Expect<HasCommand<"browsingContext.locateNodes">>,
  Expect<HasCommand<"browsingContext.handleUserPrompt">>,
  Expect<HasCommand<"browsingContext.setViewport">>,
  Expect<HasCommand<"browsingContext.reload">>,
  Expect<HasCommand<"browsingContext.traverseHistory">>,
  Expect<HasCommand<"browsingContext.close">>,
  Expect<HasCommand<"browsingContext.print">>,
  Expect<HasCommand<"input.setFiles">>,
  Expect<HasCommand<"network.addIntercept">>,
  Expect<HasCommand<"network.removeIntercept">>,
  Expect<HasCommand<"network.continueRequest">>,
  Expect<HasCommand<"network.continueResponse">>,
  Expect<HasCommand<"network.continueWithAuth">>,
  Expect<HasCommand<"network.provideResponse">>,
  Expect<HasCommand<"network.failRequest">>,
  Expect<HasCommand<"network.setCacheBehavior">>,
  Expect<HasCommand<"network.addDataCollector">>,
  Expect<HasCommand<"network.removeDataCollector">>,
  Expect<HasCommand<"network.getData">>,
  Expect<HasCommand<"network.disownData">>,
  Expect<HasCommand<"browser.createUserContext">>,
  Expect<HasCommand<"browser.removeUserContext">>,
  Expect<HasCommand<"browser.getUserContexts">>,
  Expect<HasCommand<"browser.setDownloadBehavior">>,
  Expect<HasCommand<"session.unsubscribe">>,
  Expect<HasCommand<"emulation.setForcedColorsModeThemeOverride">>,
  Expect<HasCommand<"emulation.setGeolocationOverride">>,
  Expect<HasCommand<"emulation.setLocaleOverride">>,
  Expect<HasCommand<"emulation.setNetworkConditions">>,
  Expect<HasCommand<"emulation.setScreenOrientationOverride">>,
  Expect<HasCommand<"emulation.setScreenSettingsOverride">>,
  Expect<HasCommand<"emulation.setScriptingEnabled">>,
  Expect<HasCommand<"emulation.setScrollbarTypeOverride">>,
  Expect<HasCommand<"emulation.setTimezoneOverride">>,
  Expect<HasCommand<"emulation.setTouchOverride">>,
  Expect<HasCommand<"emulation.setUserAgentOverride">>,
  Expect<HasCommand<"permissions.setPermission">>,
];

export type { Commands };
