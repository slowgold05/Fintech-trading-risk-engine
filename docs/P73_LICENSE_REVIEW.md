# Phase 7.3 — third-party license review

Roadmap 7.3 item: "Review third-party licenses, notices, dependency
vulnerabilities, and data-provider usage rights." The dependency-vulnerability
half is [P73_NPM_AUDIT_FIX_VERIFICATION.md](P73_NPM_AUDIT_FIX_VERIFICATION.md).
This covers the license half: what license each third-party package ships
under, and whether any of them impose an obligation this app does not
already meet.

## Frontend (`frontend/node_modules`)

No license-checking npm package was installed to run this (installing and
executing a fresh third-party CLI tool unattended was declined — see
"What was not attempted" below). Instead, every installed package's own
`package.json` `license`/`licenses` field was read directly out of
`node_modules` (a local, read-only operation against already-installed code,
not a new install):

- 358 packages have a `name` and `version` (the rest are nested test
  fixtures inside other packages' own test suites, not real dependencies,
  and were excluded).
- License breakdown: 301 MIT, 21 Apache-2.0, 18 ISC, 8 BSD-2-Clause,
  3 BSD-3-Clause, 2 MIT-0, 2 BlueOak-1.0.0, 1 CC0-1.0, 1 CC-BY-4.0,
  1 Python-2.0.
- Zero packages report an unknown/missing license field.
- Zero packages report a copyleft license (GPL, LGPL, MPL, EPL, CDDL family).

All permissive. No attribution-file or source-release obligation beyond the
existing `docs/diagrams/NOTICE.md` (already covers bundled font/icon assets
separately from npm packages).

## Backend (`requirements.txt` + `requirements-dev.txt`)

Ran `pip-licenses` inside the same temporary Python 3.11 venv used for this
session's test and `pip-audit` runs (75 installed packages, matching both
files combined). Full breakdown: 25 MIT, 11 "MIT License", 9 BSD-3-Clause,
7 Apache-2.0, 7 "Apache Software License", 3 BSD-2-Clause, 2 "BSD License",
2 LGPL-3.0-only, 1 each of: "Apache-2.0 OR BSD-2-Clause", BSD,
ISC, MIT-0, MPL-2.0, "Mozilla Public License 2.0 (MPL 2.0)", PSF-2.0,
"Python Software Foundation License", "The Unlicense (Unlicense)".

Four packages carry a license worth naming explicitly rather than folding
into "permissive, no action needed":

- **`psycopg` / `psycopg[binary]`** (`requirements.txt`) — LGPL-3.0-only.
  This app imports it as an unmodified library dependency (dynamic linking
  via Python's own import machinery); it does not fork, statically link, or
  distribute a modified copy of `psycopg`'s source. LGPL's copyleft terms
  attach to modifying or statically combining the library itself, not to
  using it as-is from application code — the same basis on which `psycopg`
  is used by effectively every Python project that talks to PostgreSQL. No
  obligation triggered.
- **`certifi`** (transitive dependency, not listed directly in either
  requirements file) — MPL-2.0. MPL's copyleft is file-level and only
  attaches to modified covered files that are then distributed; this app
  does not modify `certifi`'s source. No obligation triggered.
- **`hypothesis`** (`requirements-dev.txt`) — MPL-2.0. Dev/test-only
  dependency, never imported by any shipped application code or included in
  a deployed artifact. Same analysis as `certifi`: unmodified, not
  distributed as part of a product. No obligation triggered.
- **`email-validator`** (`requirements.txt`) — Unlicense (public-domain
  equivalent). No restriction of any kind.

No GPL, AGPL, or other strong-copyleft license appears anywhere in either
file's installed tree.

## Research/forecast dependencies, checked by name only

`requirements-research.txt` and `requirements-forecast.txt` were not
installed in this venv (heavy optional deps — `torch`, the `tradingagents`
git package and its own transitive tree — folded into the same "install on a
machine that can afford the compute" boundary
[FORECAST_LAB_OPEN_LIMITATIONS.md](FORECAST_LAB_OPEN_LIMITATIONS.md) already
names). Checked what can be checked without installing them:

- `pandas`, `numpy`, `einops`, `huggingface_hub`, `safetensors` are all
  well-known packages under BSD-3-Clause (`pandas`, `numpy`), MIT
  (`einops`), or Apache-2.0 (`huggingface_hub`, `safetensors`) — no
  installation needed to know this; these are long-stable, unambiguous
  license grants for packages already named by version pin.
- `torch` is BSD-style ("modified BSD license" per its own `LICENSE` file) —
  same category, no copyleft.
- `tradingagents` (pulled from `git+https://github.com/TauricResearch/TradingAgents.git@v0.7.1`,
  the exact pinned commit this app installs) — confirmed via
  `gh api repos/TauricResearch/TradingAgents` that GitHub's own detected
  license for that repository is **Apache-2.0**. Permissive, no obligation
  beyond retaining its license notice (already satisfied by installing it
  as an unmodified pip package rather than vendoring its source).

## What was not attempted

Installing and running a third-party license-scanning CLI (`license-checker`,
its `-rseidelsohn` fork) via `npx` was attempted first and declined by this
session's own permission classifier (installing and executing new,
unreviewed external code unattended, with the user away). Rather than work
around that, this review was redone by reading already-installed packages'
own `package.json`/`pip-licenses` metadata directly — read-only, no new code
execution — which is why the frontend section above explains that choice.
This is a disclosed methodology difference, not a gap: the resulting
coverage (358 npm + 75 Python packages, every license field populated) is
complete for the dependency trees this venv/`node_modules` actually has
installed.

## Conclusion

No action required. Every license encountered across the frontend
dependency tree, the backend `requirements.txt`/`requirements-dev.txt` tree,
and the research/forecast packages checked by name is permissive
(MIT/BSD/Apache-2.0/ISC/MIT-0/BlueOak-1.0.0/CC0/CC-BY-4.0/PSF-2.0/Unlicense)
or an unmodified, non-distributed LGPL/MPL dependency used exactly as
intended by its own license (`psycopg`, `certifi`, `hypothesis`). Nothing
here blocks shipping; nothing here requires a NOTICE-file change beyond what
`docs/diagrams/NOTICE.md` already covers for bundled font/icon assets.
