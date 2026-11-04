# SM-AM-01 — Asset inventory completeness

**Date:** 2026-11-04
**Control owner:** Security Operations (second line)
**Status:** Design tested. The inventory is a repo file, not a cloud discovery scan.

## Risk and control

NYDFS 500.13 asks for an inventory of systems that hold nonpublic information. SM-AM-01 reads `grc/asset_inventory.yaml`. It requires the ids `web-api`, `database`, `source-repository`, and `evidence-store`. Each needs an owner, a type, a location, and a non-empty data-class list. A missing file or a missing id fails. R-19 points at this control.

## Test of design

`tests/test_phase4_identity.py` scores the repo file as a pass and an inventory with an empty asset list as a fail. The file dated 2026-11-04 lists the Lightsail web and API container, the private PostgreSQL 17 database in `us-east-2`, the GitHub repository, the `control_evidence` store, and the market cache. Approval is pending asset owner review.

## Test of operating effectiveness

This check can pass in the working tree because the file is present. It does not prove the running Lightsail service matches the file. The hosted image does not include the file until the next deploy. Local files under `grc/evidence` are a working copy, not an independent store.

## Limits and follow-up

The inventory is maintained in the repository. It is not an AWS resource scan. Extra resources are not invented here. A pass on the file is not owner approval.
