import type { EmptyResult } from "../bidi.js";
import type { UserContext } from "./browser.js";
import type { BrowsingContext, SharedReference } from "./browsing-context.js";

/** Commands available in the WebDriver BiDi input module, which simulates user input. */
export interface InputCommands {
  /** Performs a sequence of input actions (keyboard, mouse, wheel, etc.) in the given browsing context. */
  "input.performActions": {
    params: {
      context: BrowsingContext;
      actions: SourceActions[];
    };
    result: {};
  };
}

/** A set of actions for a single input source — none, key, pointer, or wheel. */
export type SourceActions =
  | NoneSourceActions
  | KeySourceActions
  | PointerSourceActions
  | WheelSourceActions;

/** Actions for a null input source, which only supports pause. */
export interface NoneSourceActions {
  type: "none";
  id: string;
  actions: NoneSourceAction[];
}

/** A single action for a null input source. */
export type NoneSourceAction = PauseAction;

/** Actions for a keyboard input source. */
export interface KeySourceActions {
  type: "key";
  id: string;
  actions: KeySourceAction[];
}

/** A single action for a keyboard input source. */
export type KeySourceAction = PauseAction | KeyDownAction | KeyUpAction;

/** Actions for a pointer input source (mouse, pen, or touch). */
export interface PointerSourceActions {
  type: "pointer";
  id: string;
  parameters?: PointerParameters | undefined;
  actions: PointerSourceAction[];
}

/** The kind of pointer device being simulated. */
export type PointerType = "mouse" | "pen" | "touch";

/** Optional configuration for a pointer input source. */
export interface PointerParameters {
  pointerType: PointerType;
}

/** A single action for a pointer input source. */
export type PointerSourceAction =
  | PauseAction
  | PointerDownAction
  | PointerUpAction
  | PointerMoveAction;

/** Actions for a wheel input source. */
export interface WheelSourceActions {
  type: "wheel";
  id: string;
  actions: WheelSourceAction[];
}

/** A single action for a wheel input source. */
export type WheelSourceAction = PauseAction | WheelScrollAction;

/** Pauses the input sequence for an optional duration in milliseconds. */
export interface PauseAction {
  type: "pause";
  duration?: number | undefined;
}

/** Simulates pressing a key down. */
export interface KeyDownAction {
  type: "keyDown";
  value: string;
}

/** Simulates releasing a key. */
export interface KeyUpAction {
  type: "keyUp";
  value: string;
}

/**
 * 0 — Left button (primary)
 * 1 — Middle button (scroll wheel click)
 * 2 — Right button (context menu)
 * 3 — Back button
 * 4 — Forward button
 */
export type PointerButton = 0 | 1 | 2 | 3 | 4;

/** Simulates releasing a pointer button. */
export interface PointerUpAction {
  type: "pointerUp";
  button: PointerButton;
}

/** Simulates pressing a pointer button down. */
export interface PointerDownAction {
  type: "pointerDown";
  button: PointerButton;
}

/** Simulates moving a pointer to a new position. */
export interface PointerMoveAction extends PointerCommonProperties {
  type: "pointerMove";
  x: number;
  y: number;
  duration?: number;
  origin?: Origin;
}

/** Physical properties common to all pointer actions (pressure, tilt, etc.). */
export interface PointerCommonProperties {
  width?: number;
  height?: number;
  /** Normalized pressure of the pointer; 0.0..1.0 */
  pressure?: number;
  /** Tangential (barrel) pressure; -1.0..1.0 */
  tangentialPressure?: number;
  /** Clockwise rotation of the pointer around its major axis; 0..359 */
  twist?: number;
  /** Angle between the pointer and the device surface; 0 .. Math.PI / 2 */
  altitudeAngle?: number;
  /** Clockwise angle of the pointer projection on the XY plane; 0 .. 2 * Math.PI */
  azimuthAngle?: number;
}

/** Simulates a wheel scroll at a given position. */
export interface WheelScrollAction extends PointerCommonProperties {
  type: "scroll";
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  duration?: number | undefined;
  origin: Origin;
}

/** An origin defined by a specific DOM element's position. */
export interface ElementOrigin {
  type: "element";
  element: SharedReference;
}

/** The reference point for pointer/wheel coordinates — viewport, current pointer position, or a specific element. */
export type Origin = "viewport" | "pointer" | ElementOrigin;

/** Events emitted by the input module, keyed by method name. */
export interface InputEvents {
  "input.fileDialogOpened": { params: FileDialogInfo };
}

/** Union of all events emitted by the input module. */
export type InputEvent = FileDialogOpened;

/** Parameters for the `input.fileDialogOpened` event. */
export interface FileDialogInfo {
  context: BrowsingContext;
  userContext?: UserContext;
  /** The file input element that triggered the dialog, if any. */
  element?: SharedReference;
  /** Whether the dialog allows selecting multiple files. */
  multiple: boolean;
}

/** Emitted when a file picker dialog is opened. */
export interface FileDialogOpened {
  method: "input.fileDialogOpened";
  params: FileDialogInfo;
}

export type InputResult =
  | PerformActionResult
  | ReleaseActionResult
  | SetFilesResult;

export type PerformActionResult = EmptyResult;
export type ReleaseActionResult = EmptyResult;
export type SetFilesResult = EmptyResult;
