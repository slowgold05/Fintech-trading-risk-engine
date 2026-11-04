# AML and sanctions policy — draft

**Owner:** Compliance (second line)

**Status:** Draft for owner approval

**Scope:** Paper deposits, paper withdrawals, and the legal name stored on a Sentinel Markets account

## Requirements

1. A paper deposit credits the ledger and the cash balance. A paper withdrawal debits both, and only when available cash covers the amount. Available cash is the balance minus cash reserved for open buy orders. Neither movement is a bank payment.
2. A withdrawal requires a legal name and a clear payout screen recorded before the movement. Registration with a supplied legal name is screened before the account is created. A blocked name or a provider error creates no account. Changing the legal name stores the name only when the screen is clear. A blocked change records the screen and leaves the stored name unchanged.
3. With `YENTE_URL` empty, screening uses `grc/sanctions/fixture.yaml`. That file contains one fake name, `Test Sanctioned Person`. It is not an OpenSanctions or OFAC list. When `YENTE_URL` is set, the API posts one match query to `{YENTE_URL}/match/default` and treats a score at or above `YENTE_MATCH_THRESHOLD` (default 0.85) as blocked. A timeout or a bad response fails closed. Names are not written to the application log.
4. SM-AML-01 flags three or more same-direction movements that are each under $10,000 and together reach $10,000 inside 24 hours. SM-AML-02 flags withdrawals that return at least 90 percent of a deposit of at least $1,000 inside 60 minutes. The YAML file is not an activation. A second reviewer approves the version. The subject cannot close the case. The labeled scenarios are hand-written. They are not an IBM AMLSim graph export.
5. A large withdrawal, at or above `LARGE_ORDER_STEP_UP_NOTIONAL` (default $10,000), asks an enrolled account for a current authenticator code inside the idempotent request. A failed code does not post the movement.

## Evidence and exceptions

SM-SN-01 checks that every named account has a clear onboarding screen for the current normalized name and that every withdrawal has a clear payout screen. SM-AML-03 checks AML case due times. Zero named accounts, zero withdrawals, or zero cases is `no_sample`. Reports for SM-AML-01 and SM-AML-02 are in `grc/models/reports/`. On 2026-11-04 each labeled set had 5 scenarios, 2 true positives, 0 false positives, 3 true negatives, 0 false negatives, precision 1.0000, and recall 1.0000. That is not a production performance claim, and it does not activate a rule. Exceptions require an owner, reason, expiry, and remediation plan. No exception process is automated yet.

**Approval:** Pending policy owner review.
