/**
 * A reference to a DOM node in the browser. The `sharedId` stays valid across scripts in the
 * same document; after navigation or removal the browser answers `no such node`.
 * Internal: user code keeps using `Locator`.
 */
export class ElementHandle {
  constructor(
    public readonly sharedId: string,
    public readonly handle?: string,
  ) {}
}
