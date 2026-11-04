/**
 * A reference to a DOM node in the browser. The `sharedId` stays valid across scripts in the
 * same document; after navigation or removal the browser answers `no such node`.
 * What `evaluate` returns for a DOM node; user code keeps using `Locator` to act on elements.
 */
export class ElementHandle {
  constructor(public readonly sharedId: string) {}
}
