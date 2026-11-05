import type { BiDiConnector } from "../transport/bidi-connection.js";
import {
  performPointer,
  wheelScroll,
  buttonCode,
  checkClick,
  clickSteps,
  moveSteps,
  type MouseButton,
  type Point,
} from "../locator/pointer-actions.js";

/** Throws `mouse.method(): ...` unless every value is a finite number */
function numbers(method: string, what: string, ...values: number[]): void {
  if (!values.every(Number.isFinite)) {
    throw new Error(`mouse.${method}(): ${what} must be numbers`);
  }
}

/**
 * The page's mouse: real pointer input at viewport coordinates (CSS pixels from the top left of the page's
 * visible area). The pointer starts at 0, 0; `move` with `steps` runs from where the mouse last was through this object.
 */
export default class Mouse {
  private position: Point = { x: 0, y: 0 };

  constructor(
    private connector: BiDiConnector,
    private contextId: string,
    private assertOpen: () => void,
  ) {}

  /** Moves the pointer to `x`, `y` in a straight line of `steps` moves (default 1) */
  public async move(
    x: number,
    y: number,
    options?: { steps?: number },
  ): Promise<void> {
    this.assertOpen();
    numbers("move", "x and y", x, y);
    const to = { x, y };
    await performPointer(
      this.connector,
      this.contextId,
      moveSteps(this.position, to, options?.steps),
    );
    this.position = to;
  }

  /** Presses a button (default left) where the pointer is, and keeps it down until `up` */
  public async down(options?: { button?: MouseButton }): Promise<void> {
    this.assertOpen();
    await performPointer(this.connector, this.contextId, [
      {
        type: "pointerDown",
        button: buttonCode(options?.button, "mouse.down"),
      },
    ]);
  }

  /** Releases a button pressed with `down` */
  public async up(options?: { button?: MouseButton }): Promise<void> {
    this.assertOpen();
    await performPointer(this.connector, this.contextId, [
      { type: "pointerUp", button: buttonCode(options?.button, "mouse.up") },
    ]);
  }

  /**
   * Moves to `x`, `y` and clicks. `clickCount` presses in a row (2 is a double click), `delay` ms between each press and release.
   * @example
   *  await page.mouse.click(120, 80, { button: "right" });
   */
  public async click(
    x: number,
    y: number,
    options?: { button?: MouseButton; clickCount?: number; delay?: number },
  ): Promise<void> {
    this.assertOpen();
    numbers("click", "x and y", x, y);
    checkClick(options ?? {}, "mouse.click");
    await performPointer(
      this.connector,
      this.contextId,
      clickSteps({ x, y }, options, "mouse.click"),
    );
    this.position = { x, y };
  }

  /** `click` with two presses */
  public async dblclick(
    x: number,
    y: number,
    options?: { button?: MouseButton; delay?: number },
  ): Promise<void> {
    await this.click(x, y, { ...options, clickCount: 2 });
  }

  /** Turns the wheel where the pointer is by `deltaX` and `deltaY` pixels (positive is right and down) */
  public async wheel(deltaX: number, deltaY: number): Promise<void> {
    this.assertOpen();
    numbers("wheel", "deltaX and deltaY", deltaX, deltaY);
    await wheelScroll(
      this.connector,
      this.contextId,
      this.position,
      deltaX,
      deltaY,
    );
  }
}
