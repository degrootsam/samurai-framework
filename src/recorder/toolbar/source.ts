import { SETUP_JS } from "./source/setup.js";
import { DOM_JS } from "./source/dom.js";
import { NAMES_JS } from "./source/names.js";
import { PLACEMENT_JS } from "./source/placement.js";
import { VIEWS_RAIL_JS } from "./source/views-rail.js";
import { VIEWS_PANELS_JS } from "./source/views-panels.js";
import { VIEWS_RENDER_JS } from "./source/views-render.js";
import { PICKING_JS } from "./source/picking.js";
import { HANDLERS_JS } from "./source/handlers.js";
import { FIELDS_JS } from "./source/fields.js";
import { DRAG_JS } from "./source/drag.js";
import { EVENTS_TOOLBAR_JS } from "./source/events-toolbar.js";
import { EVENTS_PAGE_JS } from "./source/events-page.js";
import { RECORDER_SIDE_JS } from "./source/recorder-side.js";
import { ATTACH_JS } from "./source/attach.js";

/**
 * The recorder toolbar: a function declaration `(send) => { … }` installed as a preload script in the
 * `samurai-toolbar` sandbox realm (the caller names the sandbox), top-level documents only. `send` is the
 * toolbar's own channel (not the capture script's); it stays in this closure, which page script cannot
 * reach, and the recorder takes toolbar messages only from this sandbox's realm. It draws a
 * closed shadow root on a `<samurai-recorder-toolbar>` element and is a thin view: it renders the
 * `ToolbarState` the recorder pushes and sends `ToolbarMessage`s; every step is decided by the recorder.
 *
 * `globalThis[Symbol.for("samurai.toolbar")]` in the sandbox holds the hook:
 * - `update(state)`: the recorder's state, after every change and every page load.
 * - `reply(id, result)`: the answer to `pick` (a `PickInfo`) or to `assert`, `insert` and `add-insertable`
 *   (an `ActionReply`).
 * - `root`: the shadow root, for tests.
 * - `press(action, detail?)`: runs the handler a click on that control runs (for tests). Actions:
 *   `pause`, `resume`, `stop`, `collapse`, `expand`, `resume-yes`, `resume-no` (rail);
 *   `assert`, `insert`, `wait`, `screenshot` (open or close the tool);
 *   `pick { target }` (the element a picking click hit);
 *   `matcher { matcher }`, `not`, `assert-add` (Assert panel);
 *   `insert-item { kind, name }`, `insert-first`, `insert-new { kind }` (Insert list);
 *   `new-kind { kind }`, `new-save`, `new-cancel` (New variable or secret);
 *   `wait-add`, `screenshot-add`; `escape` (the Esc key); `dismiss { id }` (a warning's Dismiss button).
 *   Form inputs carry `data-field` (`expected`, `attribute`, `cssName`, `countIndex`, `filter`, `name`, `value`,
 *   `waitKind`, `seconds`, `shotName`, `fullPage`) and update on `input`/`change`.
 * - `rebind(send)`: used by a second run in the same document (a new recording), which keeps the host and
 *   swaps in that recording's toolbar channel.
 * - `state()`, `picking()`: the last state from `update` and whether the Assert picker is on (for tests).
 * - `dispose()`: removes the host and every listener the toolbar put on the window and document (the
 *   recording ended while the document stays open).
 *
 * A string, so no transpiler helper can end up in it.
 */
export const TOOLBAR_SOURCE = String.raw`(send) => {
${SETUP_JS}
${DOM_JS}
${NAMES_JS}
${PLACEMENT_JS}
${VIEWS_RAIL_JS}
${VIEWS_PANELS_JS}
${VIEWS_RENDER_JS}
${PICKING_JS}
${HANDLERS_JS}
${FIELDS_JS}
${DRAG_JS}
${EVENTS_TOOLBAR_JS}
${EVENTS_PAGE_JS}
${RECORDER_SIDE_JS}
${ATTACH_JS}
}`;
