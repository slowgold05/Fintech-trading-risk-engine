# Incident response plan — draft

**Owner:** Security Operations

**Status:** Draft for owner approval

**Scope:** Security and customer-notice incidents opened in Sentinel Markets

## Requirements

1. An admin or compliance officer opens an incident with a title, a severity of low, moderate, or high, and a summary. The customer-notice due time is `discovered_at` plus 30 days. That clock follows the amended Regulation S-P expectation that customer notice goes out as soon as practicable and no later than 30 days after discovery.
2. The person who opened the incident cannot record the customer notice and cannot close the incident. Closing requires a recorded notice first. An auditor can read incidents and cannot open, notify, or close them.
3. SM-IR-01 fails when notice is still missing after the due time, or when the notice timestamp is after the due time. Zero incidents is `no_sample`.
4. Amended Regulation S-P also expects oversight of service providers that receive customer information. This application does not send that notice automatically, and it does not keep a service-provider contact list. That gap stays open in this draft.
5. The Alpha Vantage key-exposure note in `grc/incidents/alpha-vantage-key-exposure.md` is a written record. It is not opened as a timed case by this plan. Provider revocation evidence is still not attached.

## Evidence and exceptions

Incident rows live in `incidents`. The compliance console lists them. A tabletop on 2026-11-04 did not open an incident and did not start a notice clock. Exceptions require an owner, reason, expiry, and remediation plan. No exception process is automated yet.

**Approval:** Pending policy owner review.
