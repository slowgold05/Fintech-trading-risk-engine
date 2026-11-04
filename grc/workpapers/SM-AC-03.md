# SM-AC-03 — Quarterly access review completeness

**Date:** 2026-11-03
**Control owner:** Compliance (second line)
**Status:** Design tested. The Q4 2026 hosted review was recorded on 2026-11-03. The control runner has not scored it yet.

## Risk and control

An account can keep a role after the reason for that role has ended. Admins and compliance officers record a retain or remove decision each quarter. The reviewer cannot be the account holder. A later role change makes the old decision stale. The daily check compares every account's current role and latest role-change row with the newest review in the open quarter.

## Test of design

Reviewed `access_reviews`, the no-self-review constraint, and `POST /compliance/access-review`. The automated test creates three accounts, confirms the check fails while any account is unreviewed, and confirms it passes only after a different person reviews each one.

## Test of operating effectiveness

On 2026-11-03 the compliance officer and the admin recorded `retain` for every other hosted account, 13 new decisions, and a follow-up read showed no unreviewed accounts. Reviewers did not review themselves. The reason was `Q4 2026 phase-2 review. Demo account retained. No role change.` A control run can still fail until the new image reads this table and confirms the observed role and role-change id.

## Limits and follow-up

The check does not remove access by itself. A remove decision still needs a separate remediation. The migration login can change the review tables, and that residual risk remains with the unmapped privileged-login risk.
