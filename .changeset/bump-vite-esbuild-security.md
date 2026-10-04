---
"agent-regression-testing": patch
---

Patch dev-dependency security advisories: pin `vite` to `^7.3.6` as a direct devDependency (previously an auto-installed peer of `vitest`), which also resolves `esbuild` to 0.28.2. Removes the `pnpm.overrides` block, which was no longer having any effect.
