# Order retry durability verification

This unit closes a flagged gap in `OrderTicket.tsx`: `// shortcut: retry intent lives only while
this ticket is mounted, when to upgrade: durable cross-reload recovery in a later release
hardening`. When a `createOrder` call fails ambiguously (network error, timeout — anything short
of an explicit business-rule rejection), the ticket locks into an "outcome unknown" state and the
only safe resolution is retrying with the *same* idempotency key. That key lived only in a React
ref: a reload (or any unmount) lost it, so resubmitting after a reload would mint a brand-new
key — a real risk of creating a second order if the original ambiguous request had actually
succeeded server-side. Frontend-only. No backend change.

This was flagged to the user directly as bigger and higher-stakes than the session's other units
(real duplicate-order risk, not a UX rough edge) before starting; they asked for it to be done
now, with the same rigor.

## Design

- New module `frontend/src/utils/orderAttemptStorage.ts` owns the `sessionStorage` key, the
  persisted shape (`{ attempt: { fingerprint, payload, key }, preview }`), and all
  read/write/clear operations. Reads strictly validate every field (treating storage as
  untrusted input, not just casting) and return `null` on anything malformed, missing, or if
  `sessionStorage` itself throws (private browsing, disabled storage, quota). Writes and clears
  are try/catch-and-ignore: a storage failure can only degrade reload recovery, never break the
  order flow itself.
- `OrderTicket.tsx` reads any persisted attempt once (`useRef(readPersistedOrderAttempt())`) and
  seeds `side`/`orderType`/`symbol`/`quantity`/`limitPrice`/`preview`/`outcomeUnknown`'s initial
  state from it. A restored ticket starts **fully locked** in the existing "outcome unknown,
  retry" UI — the existing `financialLocked`/`invalidateFinancialDraft` guards already prevent
  any edit while `outcomeUnknown` is true, so no new guard was needed there. Restoration never
  calls `createOrder` itself; it only re-arms the existing "Retry same order" button for an
  explicit click.
- Persisted on the one path an attempt becomes unknown; cleared on both paths it resolves
  (success, or a definitive business rejection). `AuthContext.tsx` also clears it on sign-out and
  on the forced-unauthorized path, so a pending attempt from one signed-in user can never
  resurface for someone else who signs into the same tab afterward — chosen deliberately over
  decoding/comparing JWTs, which this unit does not attempt.

## A subtlety Grok's implementation got right

My own spec said to sync `attemptRef.current` from the persisted ref unconditionally on every
render ("harmless and simpler"). That was wrong: without also nulling `persistedAttemptRef.current`
once the attempt resolves, the next render's unconditional sync line would immediately resurrect
the just-cleared attempt back into `attemptRef.current`, undoing the clear. Grok's diff adds
`persistedAttemptRef.current = null;` at both resolution points, which I verified closes exactly
that gap — traced through every reachable path (`ensureAttempt` can't run a *new* attempt into
existence while `outcomeUnknown` is true, since `previewConfirmableRef`/`showConfirm` are false
in that state, so there is no path where the synced `attemptRef.current` could be stomped by a
different attempt before resolution either).

## Independent verification I did myself

- `git status` confirmed only the 5 scoped files (2 new, 3 edited) changed.
- Read `orderAttemptStorage.ts` end to end: every field of `PersistedAttempt`/`PersistedOrderAttempt`
  is validated by type and enum, not just presence; invalid input is rejected, not coerced.
- Read the full `OrderTicket.tsx` diff and traced every reachable code path by hand (not just
  read it) for: (a) whether a restored, unresolved attempt can ever be auto-submitted without an
  explicit button click — it cannot, nothing calls `submitConfirmation` outside the two button
  handlers; (b) whether a fresh (non-retry) attempt could ever be created while a persisted one
  is still active, desyncing the stored key from the one actually used — it cannot, confirm is
  gated behind `!outcomeUnknown` on every path; (c) the resolution-clears-the-sync-ref interaction
  described above.
- Read the `AuthContext.tsx` diff: both token-to-null transitions call the clear function,
  exactly as specified.
- Ran every test file: `orderAttemptStorage.test.ts` (8 tests, including simulated storage
  failures), `OrderTicket.test.tsx` (31 tests: 26 existing unchanged + 5 new, including a new
  `AuthProvider pending-attempt cleanup` describe block with 2 tests), full suite
  (**333 passed**, 27 files).
- Specifically re-ran and read the three new `OrderTicket.test.tsx` cases: the core fix test
  drives a real `unmount()` + fresh `open()` (a brand-new `QueryClient`, matching what an actual
  page reload would do to the in-memory query cache) and asserts the retried `createOrder` call
  is `toEqual` the original failed call, including the identical `idempotencyKey` — not just that
  a retry happened, but that it used the exact same key; the other two prove a third mount, after
  either a successful or a definitively-rejected retry, starts completely empty/unlocked rather
  than resurrecting the resolved attempt.
- `npx tsc -b --noEmit`, `npm run lint`, `npm run build`: all clean/succeed.

## What changed

- `frontend/src/utils/orderAttemptStorage.ts` (new): `readPersistedOrderAttempt`,
  `writePersistedOrderAttempt`, `clearPersistedOrderAttempt`, strict validation.
- `frontend/src/utils/orderAttemptStorage.test.ts` (new): 8 tests.
- `frontend/src/components/OrderTicket.tsx`: seeds initial state from a persisted attempt;
  writes on the ambiguous-failure path; clears on both resolution paths; `CreateAttempt` type
  replaced by the shared `PersistedAttempt` from the new module.
- `frontend/src/components/OrderTicket.test.tsx`: `open()` now also returns `unmount`; 3 new
  cases proving the reload scenario, plus a new `AuthProvider pending-attempt cleanup` describe
  block (2 tests) for the sign-out/unauthorized clearing paths.
- `frontend/src/context/AuthContext.tsx`: clears the persisted attempt in `signOut` and in the
  unauthorized handler.

## Verification run, 2026-11-07

- `npx tsc -b --noEmit`: clean.
- `npm run lint`: clean.
- `npm run test`: **333 passed (333)**, 27 files (up from 320/26 — one new test file).
- `npm run build`: succeeds, same pre-existing bundle-size warning.

Not run locally against a real browser reload (this is a jsdom/vitest unit-test proof, not a
Selenium one) — the `unmount()` + fresh `QueryClient` pattern is the correct in-test analogue
for what a reload actually resets (component tree, query cache), and `sessionStorage` in jsdom
behaves the same way a real browser's does across that boundary within one test file/process.
No backend, migration, or provider change. No merge or deploy is claimed.
