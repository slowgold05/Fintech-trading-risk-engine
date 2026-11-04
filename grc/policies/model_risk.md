# Model risk policy — draft

**Owner:** Trading Surveillance (first line)

**Status:** Draft for owner approval

**Scope:** Surveillance and AML models that score paper orders, fills, and cash movements inside Sentinel Markets

## Requirements

1. Every surveillance model has an inventory entry: id, version, purpose, owner, limitations, and the path to its latest validation report. The inventory is `grc/models/inventory.yaml`. A model that is not in the inventory does not run on live trades.
2. A version is validated on labeled scenarios before anyone requests activation. The report states precision and recall, the counts behind those ratios, and the scenarios the model missed. A report from `python -m app.scripts.validate_surveillance` is the current labeled result. It is not approval to use the model, and it is not a claim about production alert quality.
3. The YAML file stores the version and the thresholds. It is not an activation. An admin or compliance officer requests a version. A different admin or compliance officer approves or rejects it. The requester cannot approve or reject their own request. Approving a version retires the previous active version of that rule. If the file version changed after the request, approval stops.
4. Only the active version opens cases. The backtest does not write production cases. Each open case has one due time taken from the rule's SLA. SM-SV-05 fails when a case is still open after that time or was closed late. The account that traded cannot close the case. A book with no cases is `no_sample`, not a pass.
5. Limitations stay attached to the model. These rules see only this broker's paper orders, fills, and cash movements. They do not know beneficial ownership outside the broker, and they do not prove intent.
6. AML models use the same inventory, second approver, and SLA case. `python -m app.scripts.validate_aml` writes their labeled precision and recall. The scenarios are hand-labeled paper movements. They are not an IBM AMLSim graph export. SM-AML-03 is the detective control. No AML rule is active under this draft.

## Evidence and exceptions

Validation reports are in `grc/models/reports/`. Case decisions and activation decisions are rows in `surveillance_cases`, `surveillance_activations`, `aml_cases`, and `aml_activations`. SM-SV-05 and SM-AML-03 record whether those cases met the SLA. Exceptions require an owner, reason, expiry, and remediation plan. No exception process is automated yet. No surveillance or AML rule is approved for activation by this draft.

**Approval:** Pending policy owner review.
