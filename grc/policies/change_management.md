# Change management policy — draft

**Owner:** Engineering and Security Operations

**Status:** Draft for owner approval

**Scope:** Source, dependencies, database migrations, CI rules, and deployment configuration

## Requirements

1. Changes to `main` go through a pull request. Main requires up-to-date passing backend, frontend, secrets, Python security, static-analysis, and dependency-scan jobs, including for administrators. The author records the reason, expected behavior, test result, and rollback plan in the PR.
2. A different qualified collaborator approves changes before merge. The repository currently has only one collaborator, so GitHub requires zero approvals; independent review is an open exception and must not be claimed as operating.
3. Migrations run with the separate migration credential. The restricted app role is re-granted only the table and column rights needed after migrations. Production data changes require a backup and a reconciliation check before and after cutover.
4. Gitleaks checks staged commits locally and repository history in CI. Dependabot proposes dependency and Docker updates weekly; they pass the same checks before merge.
5. Emergency changes use the same PR and CI path when available. Any bypass requires a recorded reason, owner, affected commits, follow-up review, and rollback decision. No bypass automation is implemented.

## Evidence and exceptions

SM-CM-01 records the live main-branch rule and passing CI run for the checked-out commit. SM-SM-01 records the Gitleaks job result. GitHub PRs, CI logs, and SBOM artifacts are supporting evidence. Local control JSON is still writable by the machine operator and needs independent retention. Required approving reviews and hosted deployment checks remain open.

**Approval:** Pending policy owner review.
