# Phase 3 changes — 2026-11-03

This note records the surveillance and model-risk work for Phase 3 of the GRC roadmap. The build is detection rules, a labeled backtest, case management with an SLA, and a second approver before a rule can run on live trades.

The hosted Lightsail service was not updated. `aws login` was not run. The public API is still the previous image. The hosted database is still at Alembic `c7e8f1a2b345`. Migrations `1c4e8a7b2d90` and `a8d3c1e4b672` are in the working tree only. No surveillance rule is active. The model-risk policy is a draft.

Phase 2's deferred deploy is unchanged and now also includes this migration. See `docs/PHASE2_CHANGES.md`.

## Why these changes exist

Phase 3 asks for four manipulation patterns as versioned rules, a backtest that can show precision and recall, cases that have a due time, and a second person before a rule is turned on. The GRC output is a model inventory, one validation report per rule, and a model-risk policy.

The numbers in the reports come from running the detectors on labeled scenarios. They were not typed in by hand, and they are not a claim about alerts on the live paper book. The live book has no surveillance cases.

## Versioned rules

The rule files are:

| Rule | File | What it scores |
| --- | --- | --- |
| SM-SV-01 | `grc/surveillance/SM-SV-01.yaml` | Offsetting buy and sell fills, same symbol, inside 15 minutes, close in size and price. Same account or two accounts. |
| SM-SV-02 | `grc/surveillance/SM-SV-02.yaml` | A displayed order of at least 1,000 shares, canceled within 30 seconds, plus a smaller opposite fill by the same account within 10 minutes. |
| SM-SV-03 | `grc/surveillance/SM-SV-03.yaml` | A 10% rise inside 15 minutes, with the account buying before the peak and selling within 10 minutes at or after the peak. |
| SM-SV-04 | `grc/surveillance/SM-SV-04.yaml` | One account's quantity in 10 minutes is at least 50 and at least 5 times the median of at least 3 other accounts. |

`app/services/surveillance_rules.py` loads only `SM-SV-*.yaml` from `grc/surveillance/`. SM-SV-05 is a control, so it stays in `grc/controls/` and is not a detector. The YAML has no status field. A file on disk does not activate the rule.

Each file lists limitations. The shared one is that the model sees only this broker's paper orders and fills. It does not know beneficial ownership elsewhere. SM-SV-02 also says a large market order that cancels its remainder immediately can look like a spoof, and cancels from before `canceled_at` existed are not scored. The minimum displayed size of 1,000 shares keeps ordinary one-share remainders out.

The image copies `grc/surveillance` so the API can read the files after a future deploy. The current image does not have that copy.

## Detectors and the backtest

`app/services/surveillance_detect.py` scores a normalized list of order, cancel, and trade events. The live scan and the backtest call the same function. The detector does not contain the scenario ids.

Labeled scenarios are `grc/surveillance/scenarios/SM-SV-01.json` through `SM-SV-04.json`. Each rule has two scenarios that should alert and two that should not, including a near miss. `app/services/surveillance_backtest.py` counts true positives, false positives, true negatives, and false negatives. Precision is true positives divided by alerts. Recall is true positives divided by labeled positives. If either denominator is zero, the ratio is missing and the report script exits with an error.

`python -m app.scripts.validate_surveillance` ran on 2026-11-03 and wrote `grc/models/inventory.yaml` and `grc/models/reports/SM-SV-01.md` through `SM-SV-04.md`. Every rule scored:

- Scenarios: 4
- True positives: 2
- False positives: 0
- True negatives: 2
- False negatives: 0
- Precision: 1.0000
- Recall: 1.0000
- Misses: none

The inventory status is `draft`. The approval line is "Pending model owner review." A report is not an activation.

## Activation, cases, and the SLA

Migration `alembic/versions/a8d3c1e4b672_add_surveillance_cases.py` revises `1c4e8a7b2d90`. It adds:

- `orders.canceled_at`, so a spoof rule can measure how fast an order was pulled. Older canceled orders have no timestamp and are skipped.
- `surveillance_activations`, with statuses `pending`, `active`, `rejected`, and `retired`. A check requires the approver to be a different user.
- `surveillance_cases`, with statuses `open` and `closed`. A check blocks the subject from being the closer.

`app/models/order.py` stores `canceled_at`. `app/services/order_book.py` sets it when a trader cancels an open order and when an unfilled market remainder is canceled. It does not invent a time for rows that were already canceled.

`app/services/surveillance_cases.py` is the workflow:

- An admin or compliance officer requests the current file version, with a reason. A second pending request for the same rule is rejected.
- A different admin or compliance officer approves or rejects it. The requester cannot do either. Approval retires the previous active version of that rule. Approval returns 409 if the YAML version changed after the request.
- The live scan loads only rows whose status is `active` and whose version still matches the file. It opens at most one open case per rule, account, and symbol. `due_at` is the scan time plus the rule's `sla_hours`. A second scan does not open a duplicate.
- The backtest never writes cases.
- Closing a case needs a disposition (`true_positive`, `false_positive`, or `inconclusive`) and a reason. The subject receives 403. A case that is already closed returns 409.

The compliance API, on the existing compliance router:

- `GET /compliance/surveillance/rules`
- `POST /compliance/surveillance/rules/{rule_id}/request`
- `POST /compliance/surveillance/activations/{request_id}/approve`
- `POST /compliance/surveillance/activations/{request_id}/reject`
- `GET /compliance/surveillance/cases`
- `POST /compliance/surveillance/cases/{case_id}/close`
- `POST /compliance/surveillance/run`

Auditors can read. They cannot request, approve, reject, close, or run a scan. Traders cannot open these routes.

The compliance screen has a Surveillance card. It lists rule activation state and cases, and it says "No surveillance cases." when the book is empty. Admins and compliance officers can request activation and approve someone else's pending request. That screen was checked with the frontend tests. It was not clicked through in a browser.

When `SCHEDULED_JOBS_ENABLED=true`, the daily cycle runs the live scan after the quote refresh, the app-role controls, and the evidence backfill. The flag still defaults to false. The hosted service does not run the cycle. A scan with no active rules opens nothing.

## The control and the risk

`grc/controls/SM-SV-05.yaml` checks that every case is closed by its due time. `check_case_sla` counts all cases. A breach is an open case whose due time has passed, or a closed case whose `closed_at` is after `due_at`. Zero cases is `no_sample`. The control runner calls this check with the other app-role controls.

R-17 in `grc/risk_register.yaml` is the risk that paper trading hides wash trades, spoofing, pump-and-dump, or unusual volume. Its only linked control is SM-SV-05. The four rule ids are models. Putting them in the risk's control list would leave the register pointing at files the control runner does not score.

`grc/control_matrix.csv` was regenerated and lists 15 controls. The register has 17 risks. The workpaper is `grc/workpapers/SM-SV-05.md`. It says the hosted population does not exist yet.

`app/scripts/configure_postgres_role.py` grants the app login insert and the decision columns on the two new tables. It does not grant delete. Run that script again after the migration. `SELECT` still comes from the existing grant on all tables. Orders already allow update, so `canceled_at` needs no new grant.

## Policy

`grc/policies/model_risk.md` is a draft. It requires an inventory entry, a labeled report before a request, a second approver, and SLA monitoring after activation. The approval line is "Pending policy owner review." It was not marked approved. The reports were produced by the validation script in this repository. They were not attributed to an outside writer.

## Tests

`python -m pytest -q` passed: 81 tests. That includes `tests/test_surveillance.py`, which checks the labeled counts, that precision and recall are the ratios of those counts, that the backtest writes no cases, that the requester cannot approve, that a changed version cannot be approved, that the subject cannot close the case, that a late case fails SM-SV-05, and that one active wash rule opens one case and does not open a second.

`npm test` in `frontend` passed: 7 tests. The compliance page shows the empty case state and, in a second test, an active rule with one open case.

No browser was available for a click-through of the compliance screen. The vitest tests are the check that was run.

## What this does not do

- It does not deploy the image, sign in to AWS, or migrate the hosted database.
- It does not activate any rule. Activation still needs two different reviewers after a deploy.
- It does not show operating effectiveness for SM-SV-05. There are no hosted cases, so a future run on an empty book is `no_sample`.
- It does not prove the models on live trading. The 1.0000 precision and recall are the labeled set of four scenarios per rule.
- It does not approve the model-risk policy, the other draft policies, residual-risk scoring, or the surveillance rules.
- It does not add the Alpha Vantage provider revocation record, an evidence store outside the database, MFA, or the Phase 4 and later roadmap items.
- It does not score cancels that have no `canceled_at`. Those rows stay unscored rather than getting a guessed time.
