import { ConfigEditError } from "../../../project/config-edit.js";
import { SECRET_NAME } from "../../../project/secrets-file.js";
import { ExistsError, VARIABLE_NAME } from "../../../project/variables.js";
import type { ElementHandle } from "../../../script/element-handle.js";
import type { LocatorCall, LocatorSpec } from "../../../steps/model.js";
import type { ActionReply } from "../protocol.js";
import type { ActionContext, Of } from "../types.js";
import {
  fail,
  nameProblem,
  NO_ENVIRONMENT,
  PAUSED,
  TYPE_FAILED,
  UNIDENTIFIABLE,
} from "./reply.js";

/** Types a variable, secret or input the tester already has into the field they picked, and records one `insert` step */
export async function insertAction(
  ctx: ActionContext,
  message: Of<"insert">,
): Promise<ActionReply> {
  if (ctx.isPaused()) return fail(PAUSED);
  const { kind, name } = message;
  const value =
    kind === "secret"
      ? ctx.secrets.get(name)
      : kind === "input"
        ? ctx.inputs.get(name)
        : ctx.variables.get(name);
  if (value === undefined)
    return fail(
      kind === "secret"
        ? `Set a value for ${name} first`
        : kind === "input"
          ? `There is no input "${name}"`
          : `There is no variable "${name}"`,
    );
  const locator = await locate(ctx, message);
  if (!locator) return fail(UNIDENTIFIABLE);
  return typeIn(ctx, locator, kind, name, value);
}

/**
 * Adds a new variable, secret or input, then types it into the field and records the `insert` step. A variable or
 * secret is saved to the project first; an input is declared by the step itself.
 */
export async function addInsertableAction(
  ctx: ActionContext,
  message: Of<"add-insertable">,
): Promise<ActionReply> {
  if (ctx.isPaused()) return fail(PAUSED);
  const { kind, name } = message;
  const value = String(message.value ?? "");
  if (kind === "input") return addInput(ctx, message, name, value);
  if (kind === "env" && !ctx.options.canAddVariables)
    return fail(NO_ENVIRONMENT);
  const known =
    kind === "env"
      ? ctx.variables.has(name)
      : ctx.secrets.get(name) !== undefined;
  if (known) return fail(`"${name}" already exists`, "name");
  // Found before anything is written: an element that can't be filled leaves the project as it was
  const locator = await locate(ctx, message);
  if (!locator) return fail(UNIDENTIFIABLE);
  const written =
    kind === "env"
      ? await write(
          () => ctx.deps.addVariable(name, value),
          (err) =>
            err instanceof ConfigEditError
              ? fail(
                  `samurai.config.ts can't be changed automatically. Add ${name} to environments.${ctx.options.environment}.variables yourself.`,
                )
              : err instanceof ExistsError || !VARIABLE_NAME.test(name)
                ? fail(errorText(err), "name")
                : fail(errorText(err)),
        )
      : await write(
          () => ctx.deps.setSecret(name, value),
          (err) =>
            // An error never echoes the value
            SECRET_NAME.test(name)
              ? fail(scrub(errorText(err), value))
              : fail(scrub(errorText(err), value), "name"),
        );
  if (written) return written;
  if (kind === "env") ctx.variables.set(name, value);
  else {
    ctx.secrets.set(name, value);
    ctx.deps.secretAdded(name);
  }
  ctx.push();
  return typeIn(ctx, locator, kind, name, value, true);
}

/**
 * Types a new input's value and records the step with the declaration; the project is not written, the
 * test's own `inputs` carries the default. The name counts as taken once the step is recorded.
 */
async function addInput(
  ctx: ActionContext,
  message: Of<"add-insertable">,
  name: string,
  value: string,
): Promise<ActionReply> {
  const problem = nameProblem(name);
  if (problem) return fail(problem, "name");
  if (ctx.inputs.has(name)) return fail(`"${name}" already exists`, "name");
  const locator = await locate(ctx, message);
  if (!locator) return fail(UNIDENTIFIABLE);
  const reply = await typeIn(ctx, locator, "input", name, value, false, true);
  if (reply.ok) {
    ctx.inputs.set(name, value);
    ctx.push();
  }
  return reply;
}

/** Undefined when `work` succeeded, else the reply for its error */
async function write(
  work: () => Promise<void>,
  replyFor: (err: unknown) => ActionReply,
): Promise<ActionReply | undefined> {
  try {
    await work();
    return undefined;
  } catch (err) {
    return replyFor(err);
  }
}

async function locate(
  ctx: ActionContext,
  message: { target?: ElementHandle; candidates: LocatorCall[] },
): Promise<LocatorSpec | undefined> {
  if (!message.target) return undefined;
  try {
    return await ctx.deps.rank(message.target, message.candidates);
  } catch {
    return undefined; // the element went away
  }
}

async function typeIn(
  ctx: ActionContext,
  locator: LocatorSpec,
  kind: "env" | "secret" | "input",
  name: string,
  value: string,
  saved = false,
  declare = false,
): Promise<ActionReply> {
  try {
    await ctx.deps.type(locator, value);
  } catch {
    // Typing clicks the field, which closes the panel the reply is for: the toast is what the tester sees
    ctx.showToast(
      saved ? `Saved ${name}, but couldn't type into that field` : TYPE_FAILED,
    );
    ctx.push();
    return fail(TYPE_FAILED);
  }
  ctx.deps.observe({
    type: "insert",
    locator,
    value: { kind, name },
    ...(declare && { declare: value }),
  });
  return { ok: true };
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const scrub = (text: string, secret: string) =>
  secret === "" ? text : text.split(secret).join("••••••");
