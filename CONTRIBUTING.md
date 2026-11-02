# Contributing

[github.com/degrootsam/samurai-framework](https://github.com/degrootsam/samurai-framework) is a **read-only mirror**. The framework is developed in `packages/framework` of the SAMURAI monorepo, which is private, and every change there is copied here automatically. This repository's root is that folder.

- **Issues are welcome here.** Bug reports, questions and feature requests go in this repository's [issues](https://github.com/degrootsam/samurai-framework/issues).
- **Pull requests aren't merged here.** Every change is made in the monorepo by the maintainer and reaches this repository with the next copy. The best way to propose a change is an issue that describes it.
- **Releases** are published to npm as [`@itmetsam/samurai-framework`](https://www.npmjs.com/package/@itmetsam/samurai-framework) and tagged here as `vX.Y.Z`. What changed in each one is in [CHANGELOG.md](CHANGELOG.md). Its commit links point into the monorepo and are not public.
- **History.** The history before the move into the monorepo is kept under the tag `pre-monorepo`, so links to older commits keep working.

The [developer guide](docs/contributing.md) describes the layout, the conventions and how to run the framework's tests. Most of it applies to a checkout of this mirror as well. The parts about Nx, CI and releases are for the maintainer, working in the monorepo.
