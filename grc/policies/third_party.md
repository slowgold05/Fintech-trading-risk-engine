# Third-party risk policy — draft

**Owner:** Security Operations

**Status:** Draft for owner approval

**Scope:** External services the application calls, and the roadmap names that are not connected

## Requirements

1. A vendor assessment names the data shared, the criticality, the concentration risk, and an exit path. Assessments in `grc/vendors/` are drafts. None is approved. No SOC report is attached.
2. The market path that runs today can call Yahoo Finance and, when a key is configured, Alpha Vantage. The symbol universe can be refreshed from the SEC company-ticker file. User requests read the cache. They do not call those providers.
3. Alpaca, Massive, and OpenSanctions are names in the product roadmap. They are not connected. `YENTE_URL` defaults to empty, so sanctions screening uses the local fixture. There is no bundled yente service.
4. GRC Sentinel does not monitor this repository. `grc/integrations/grc_sentinel.md` records that fact. Policies in this folder were written in the repository.

## Evidence and exceptions

The assessments are the evidence for this draft. A missing or stale assessment is a documentation gap, not a passing control. Exceptions require an owner, reason, expiry, and remediation plan. No exception process is automated yet.

**Approval:** Pending policy owner review.
