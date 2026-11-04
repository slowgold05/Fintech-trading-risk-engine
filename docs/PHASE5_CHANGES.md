# Phase 5 changes — 2026-11-04

This note records the AML, sanctions, and incident work for Phase 5 of the GRC roadmap. The build is paper deposits and withdrawals, two cash rules with labeled scores, a local sanctions fixture with an optional yente client, and incident cases with a 30-day customer-notice clock.

The hosted Lightsail service was not updated. `aws login` was not run. The public API is still the previous image. The hosted database is still at Alembic `c7e8f1a2b345`. Migration `c4d8e1a7b936` is in the working tree only. `YENTE_URL` stays empty. `MFA_REQUIRED` stays false. No policy in this phase was marked approved.

The deferred deploy in `docs/PHASE2_CHANGES.md` now also includes migrations `c4d8e1a7b936` and `d5e9f2b8c047`.

## Why these changes exist

Phase 5 asks for deposits and withdrawals with AML rules for structuring and rapid movement, scored against AMLSim data, sanctions screening with yente at onboarding and on payouts, and incident cases with notification timers. The GRC output is an AML and sanctions policy, an incident response plan, and a mapping to amended Regulation S-P.

IBM AMLSim was not downloaded and was not run. The labeled files in `grc/aml/scenarios/` are hand-written paper movements. The reports say that. yente is not running. The fixture is one fake name. The policies are drafts.

## Paper cash

`POST /cash/movements` takes `deposit` or `withdrawal`, an `Idempotency-Key`, and an optional `X-Step-Up-Code`. The ledger event is `cash_deposit` or `cash_withdrawal`, and the cash balance moves by the same amount. A withdrawal needs `users.full_name`, a clear payout screen, and enough cash after open-buy reservations.

A withdrawal at or above $10,000 uses the existing large-order step-up inside the idempotent execute, so a bad code rolls the movement back. The payout screen is stored before that execute. A failed step-up can leave a clear screen and no movement. SM-SN-01 does not treat a clear screen without a withdrawal as a miss.

`PUT /auth/name` sets the legal name after a screen. Registration accepts an optional `full_name`. A blocked or unavailable screen returns HTTP 403 and does not create the user. Existing registration tests that omit the name still pass.

The portfolio page has a legal-name field. Trader accounts also see deposit and withdrawal. That screen was not clicked through in a browser. Frontend tests cover the compliance page, not this form.

## Sanctions

`grc/sanctions/fixture.yaml` is the source when `YENTE_URL` is empty. The only name is `Test Sanctioned Person`. The file says it is not OpenSanctions or OFAC. When the URL is set, the service POSTs `{"queries": {"q": {"schema": "Person", "properties": {"name": [name]}}}}` to `{YENTE_URL}/match/default` with a 3-second timeout and threshold 0.85. Errors fail closed with HTTP 403 and `Sanctions screening is unavailable`. Names are not logged. No Docker yente service was added.

## AML rules

SM-AML-01 counts same-user, same-kind movements under $10,000. Three or more that sum to at least $10,000 inside 24 hours is a hit. An amount at the threshold is not counted. SM-AML-02 looks for withdrawals inside 60 minutes that return at least 90 percent of a deposit of at least $1,000.

The YAML file is not an activation. A second reviewer must approve the version. The requester cannot approve it. One open case is kept per rule and account. The scan runs after the cash movement commits. The scheduled cycle is refresh, controls, backfill, surveillance, then AML. `SCHEDULED_JOBS_ENABLED` stays false in Compose.

`python -m app.scripts.validate_aml` wrote the reports on 2026-11-04. Both rules scored 5 scenarios, 2 true positives, 0 false positives, 3 true negatives, 0 false negatives, precision 1.0000, and recall 1.0000, with no misses. Those numbers are the labeled result. They are not a production claim. The inventory merge keeps the four surveillance models when the AML writer runs, and the other way around. Approval stays `Pending model owner review`.

## Incidents

An admin or compliance officer opens an incident. Customer notice is due 30 days after discovery, which is the outer bound used here for amended Regulation S-P. The opener cannot record notice or close the case. Close requires notice first. An auditor is read-only. SM-IR-01 fails when notice is missing after the due time or is timestamped late. Zero incidents is `no_sample`.

The Alpha Vantage exposure note was not turned into a timed case. Service-provider notice is described in the incident plan and is not automated.

## Controls and risks

SM-AML-03, SM-SN-01, and SM-IR-01 were added. R-20, R-21, and R-22 point at those controls. Empty populations are `no_sample`. KRIs are in `grc/kris.yaml`: open AML cases past due, named accounts without a clear onboarding screen, incidents past notice due, and open surveillance cases past due. The threshold is 0. A zero population is `no_sample`. The compliance page lists AML cases, incidents, and KRIs.

`python -m app.scripts.export_controls` wrote 23 controls to `grc/control_matrix.csv`. The register has 24 risks. The roadmap aim of 30 to 40 controls was not met. No hollow control was added to close that gap. There is no XLSX export, because that would add a dependency. The CSV is generated from the YAML.

## Tests

`python -m pytest -q` passed 95 tests on 2026-11-04. The Phase 5 file covers the labeled scores, the sanctioned-name block, activation by a second person, and the 30-day notice clock. Frontend `eslint` on the touched files, `tsc -b`, and `npm test` passed (9 tests). The UI was not clicked through in a browser.

## What is still open

The hosted image does not have this code. Leave `YENTE_URL` empty and `MFA_REQUIRED` false on the deferred deploy. Re-run the app-role grant script after the new migrations, and only when a deploy is requested. Policies `grc/policies/aml_sanctions.md` and `grc/policies/incident_response.md` are pending policy owner review. No AML rule is active.
