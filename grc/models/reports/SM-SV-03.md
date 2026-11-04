# SM-SV-03 validation report

**Model:** Pump and dump version 1
**Type:** deterministic_threshold
**Owner:** Trading Surveillance (first line)
**Status:** Draft. Pending model owner review. This report is not an activation.

## Principle

The check follows the SR 26-2 idea that a model is inventoried, validated before use, activated only by someone other than the requester, and monitored after activation. The counts below come from `app.services.surveillance_backtest.score_rule` on `grc/surveillance/scenarios`. They describe this labeled set. They are not a production performance claim.

## Labeled result

- Scenarios: 4
- True positives: 2
- False positives: 0
- True negatives: 2
- False negatives: 0
- Precision: 1.0000 (true positives / alerts)
- Recall: 1.0000 (true positives / labeled positives)
- Misses: none

## Limitations

- The price path is this book's own fills, not a consolidated market.
- The rule does not show that the account caused the rise.
- A rise below the threshold is ignored even if the account sells afterward.

## Ongoing monitoring

An active version opens one case per rule, account, and symbol. The due time is 24 hours after the case opens. SM-SV-05 fails when a case is still open after that time or was closed late. A book with no cases is `no_sample`. The backtest does not write production cases.

**Approval:** Pending model owner review.
