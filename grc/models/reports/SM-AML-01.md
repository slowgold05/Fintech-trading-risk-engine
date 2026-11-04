# SM-AML-01 validation report

**Model:** Structuring version 1
**Type:** deterministic_threshold
**Owner:** Compliance (second line)
**Status:** Draft. Pending model owner review. This report is not an activation.

## Principle

The check follows the SR 26-2 idea that a model is inventoried, validated before use, activated only by someone other than the requester, and monitored after activation. The counts below come from `app.services.aml_backtest.score_rule` on `grc/aml/scenarios`. The scenarios are hand-labeled paper movements. They are not an IBM AMLSim graph export. They are not a production performance claim.

## Labeled result

- Scenarios: 5
- True positives: 2
- False positives: 0
- True negatives: 3
- False negatives: 0
- Precision: 1.0000 (true positives / alerts)
- Recall: 1.0000 (true positives / labeled positives)
- Misses: none

## Limitations

- The labeled scenarios are hand-written paper movements. They are not an IBM AMLSim graph export.
- A movement at or above the threshold is not counted as structuring.
- The rule does not know cash activity outside this broker.

## Ongoing monitoring

An active version opens one case per rule and account. The due time is 24 hours after the case opens. SM-AML-03 fails when a case is still open after that time or was closed late. A book with no cases is `no_sample`. The backtest does not write production cases.

**Approval:** Pending model owner review.
