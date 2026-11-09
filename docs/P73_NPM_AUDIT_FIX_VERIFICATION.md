# Phase 7.3 — frontend dependency vulnerabilities, partial fix

Roadmap 7.3 item: "Review third-party licenses, notices, dependency
vulnerabilities, and data-provider usage rights."

## What this is

`npm ci` has reported 7 moderate-severity vulnerabilities since the P0-A
baseline (`PRODUCT_V2.md`: "`npm ci` also printed 7 moderate severity
vulnerabilities. `npm audit fix` was not run"). All 7 are inside the
`@typescript-eslint/*` dev-dependency chain (lint tooling only — never
bundled into `dist/`, never shipped to a browser), rooted in a `minimatch`
ReDoS advisory.

Ran `npm audit fix` (no `--force`) inside `frontend/`. This bumped
`@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`,
`@typescript-eslint/type-utils`, and `@typescript-eslint/utils` from
`8.61.1` to `8.72.1` in `frontend/package-lock.json` only — `package.json`'s
own `^8.x` range was already compatible, so no manifest change was needed.

## What this does not fix

`npm audit` after the bump still reports the same 7 moderate findings. The
underlying `minimatch` advisory affects every currently published `8.x`
release of `@typescript-eslint/typescript-estree`'s own dependency range
(`7.0.0 - 11.0.0`); closing it fully would require `npm audit fix --force`,
which the audit output confirms resolves only via a major
`typescript-eslint` version bump (9.x) that could change lint rule behavior
across the whole frontend. That is a real, separate decision — not applied
here, and not something to force unprompted. Flagged as the next step if
this is picked up again, not silently left unmentioned.

## Verification

After the bump, re-ran the full frontend pipeline with no other change:

- `npm run lint` — exit 0, no new warnings.
- `npm test -- --run` — 30 files, 417 tests passed (unchanged count).
- `npm run build` — exit 0, same pre-existing >500kB chunk-size warning,
  unrelated to this change.

Only `frontend/package-lock.json` changed. No application source file
changed.
