# Phase 4 changes — 2026-11-04

This note records the identity and access work for Phase 4 of the GRC roadmap. The build is time-based authenticator enrollment, login-risk scoring with step-up, a current code on a large order, and three controls that score enrollment, high-risk sessions, and the asset inventory.

The hosted Lightsail service was not updated. `aws login` was not run. The public API is still the previous image. The hosted database is still at Alembic `c7e8f1a2b345`. Migrations `1c4e8a7b2d90`, `a8d3c1e4b672`, and `b7e2a9c4d815` are in the working tree only. `MFA_REQUIRED` stays false. No account on the live demo has an authenticator. The access-control policy and the asset inventory stay drafts.

The deferred deploy in `docs/PHASE2_CHANGES.md` now also includes migration `b7e2a9c4d815`.

## Why these changes exist

Phase 4 asks for MFA on every role, login-risk scoring for a new device, impossible travel, and credential stuffing, step-up authentication, passkey signing of large orders, and a quarterly access review. The GRC output is evidence for NYDFS 500.12 and 500.13, plus the first completed access review.

The quarterly review already existed. On 2026-11-03 the live API recorded 13 `retain` decisions for Q4 2026. The follow-up read had no unreviewed accounts. Reviewers did not review themselves. The reason was `Q4 2026 phase-2 review. Demo account retained. No role change.` That sample is the first completed access review. It was not run again.

Passkey signing is the roadmap's own cut item. This build uses a six-digit authenticator code for sign-in and for a large order. WebAuthn was not added. No new Python dependency was added.

## Authenticator and login risk

`app/services/mfa.py` implements TOTP with the standard library: HMAC-SHA1, 6 digits, a 30-second step, and one step of clock skew. A code cannot be reused inside that window because the factor stores `last_counter`.

The secret is encrypted before it is stored. The cipher is an HMAC-SHA256 keystream keyed by `JWT_SECRET`, with a random nonce and the prefix `mfa-v1`. The database does not hold the plaintext secret. Rotating `JWT_SECRET` makes enrolled secrets unreadable. The enrollment screen shows the secret once. There is no QR-code library.

`MFA_REQUIRED` defaults to false. With the flag off, an account that has no confirmed factor can still receive a session, including the existing demo and the existing tests. An account that already has a confirmed factor always completes a code before any access token or refresh cookie is issued. When the flag is true, an account with no confirmed factor gets HTTP 403, `MFA enrollment is required`, and no session.

Enrollment works without a session, because a required flag would otherwise lock a new account out. `POST /auth/mfa/enroll` and `POST /auth/mfa/enroll/confirm` take the email and password. A signed-in user can use `POST /auth/mfa/setup` and `POST /auth/mfa/confirm`.

Login risk is scored in `app/services/login_risk.py`:

| Signal | Score | When it applies |
| --- | --- | --- |
| New device | 40 | A prior successful login exists, and this user-agent hash has not been seen. The first login is not a new device. |
| Impossible travel | 50 | Both addresses match `LOGIN_GEO_PREFIXES` (`cidr=name`, comma-separated) and the region names differ inside `IMPOSSIBLE_TRAVEL_MINUTES` (default 60). An unmapped address stays unknown. |
| Credential stuffing | 50 | At least 5 failures across at least 3 distinct emails from the same IP in 10 minutes. |

The step-up threshold is 40. A score at or above that threshold, with no confirmed factor, is denied: HTTP 403, `This login needs an authenticator before a session can be issued`, outcome `denied`, and no session. With a confirmed factor, login returns `{mfa_required: true, challenge_id, reasons}` and does not set the refresh cookie. `POST /auth/login/mfa` consumes the challenge. A wrong, reused, or expired code is HTTP 401. A valid code records outcome `success` with `step_up_satisfied` true and then issues the tokens. A wrong password still returns the same 401 body as a missing account. The failure is written to `login_events` and committed before that 401.

`LOGIN_GEO_PREFIXES` defaults to empty. This build does not include a geolocation database.

## Large orders

A limit order's notional is quantity times limit price. A market order's notional is quantity times the cached quote times 1.20. A direct trade uses the live execution price. The default threshold is `LARGE_ORDER_STEP_UP_NOTIONAL=10000`. A notional at or above that line calls `require_notional_step_up` inside the idempotent execute function, so a rejected code rolls the idempotency row back and a replay of a completed order does not ask for a second code.

The header is `X-Step-Up-Code`. An enrolled account must send a current code or the order returns HTTP 403. An account with no factor is allowed while `MFA_REQUIRED` is false, and is rejected while the flag is true. The order ticket has an optional authenticator field. The code is not part of the idempotency fingerprint.

## Controls, inventory, and the register

Three controls were added. They run with the other app-role checks, so the scheduler picks them up after a future deploy. They do not have a hosted population.

| Control | What a fail means | Empty population |
| --- | --- | --- |
| SM-AC-04 | Any account has no confirmed authenticator. | `no_sample` when the book has zero accounts. |
| SM-AC-05 | A login with risk score at least 40 has outcome `success` and `step_up_satisfied` false. | `no_sample` when there are zero login events. |
| SM-AM-01 | `grc/asset_inventory.yaml` is missing, or it lacks `web-api`, `database`, `source-repository`, or `evidence-store`, or one of those rows lacks an owner, type, location, or data class. | A missing file fails. |

After a deploy, an unenrolled book fails SM-AC-04. That is the correct result. NYDFS 500.12 operating effectiveness is not met until every account enrolls and `MFA_REQUIRED` is on.

`grc/asset_inventory.yaml` is dated 2026-11-04. It lists the Lightsail web and API container, the private PostgreSQL 17 database in the selected Region `us-east-2`, the GitHub repository, `control_evidence`, and the market cache. Approval is `Pending asset owner review`. The file is a repository inventory. It is not an AWS discovery scan. The image copies it so the API can read it after a future deploy. The current image does not have that copy.

R-13 now points at SM-AC-05. R-18 (password-only sign-in) points at SM-AC-04. R-19 (an incomplete asset inventory) points at SM-AM-01. R-08 and R-09 stay unmapped. The register has 19 risks. The matrix has 18 controls. `python -m app.scripts.export_controls` rewrote `grc/control_matrix.csv` on 2026-11-04.

`grc/policies/access_control.md` now describes the authenticator, the default-off flag, high-risk denial, and the large-order code. **Approval:** Pending policy owner review. The policy was not marked approved.

Workpapers `grc/workpapers/SM-AC-04.md`, `SM-AC-05.md`, and `SM-AM-01.md` record the design tests. They do not claim a hosted operating sample.

## Database grants

Migration `b7e2a9c4d815` creates `mfa_factors`, `login_events`, and `login_challenges`. It is not applied to the hosted database. `configure_postgres_role.py` grants the app login column-level insert and update on the factor secret and confirmation fields, insert-only on login events, and insert plus `consumed_at` update on challenges. There is no delete grant on the factor table. Re-run that script after the migration. The entrypoint already runs it when `RUN_DB_SETUP=true`.

## Tests

On 2026-11-04, `python -m pytest -q` reported 87 passed. The new file `tests/test_phase4_identity.py` covers a reused code, a new device without a factor, stuffing and a configured travel pair, the two access-control populations, a large order that is blocked without a current code, and the asset inventory. Frontend `npm test` reported 9 passed, including the password sign-in and the step-up code field. ESLint and `tsc -b` were run on the touched frontend files. The login and order screens were not clicked through in a browser.

## What this does not do

- It does not deploy the image, run `aws login`, or apply `b7e2a9c4d815` to the hosted database.
- It does not implement passkeys.
- It does not turn `MFA_REQUIRED` on. The live demo can still sign in with a password.
- It does not mark SM-AC-04 as passing. There is no hosted authenticator population.
- It does not treat the asset file as a cloud inventory, and it does not mark that file approved.
- It does not invent a second access review. The 2026-11-03 Q4 sample remains the first completed review.
- It does not add the Alpha Vantage provider revocation record or an evidence store outside the database.
- Phase 5 (AML, sanctions, and incidents) has not started.
