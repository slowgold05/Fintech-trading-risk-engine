# SM-FC-01 validation report

**Model:** Historical volatility forecast version 1
**Type:** historical_volatility
**Owner:** Market Risk
**Status:** Draft. Pending model owner review. This report is not an activation.

## Principle

The check follows the SR 11-7 idea that a model is inventoried and validated before a risk rule uses it. The counts below come from `app.services.forecast.walk_forward` on `sample_closes`. Hit rate is the share of next closes that landed inside the one-step band. It is not precision or recall.

## Walk-forward result

- Trials: 30
- Hits: 30
- Hit rate: 1.0000
- Passed: True

## Seeded paths

These paths use the Python standard library random generator and the sample standard deviation of log returns. They are not Kronos samples.

- Paths: 200
- Horizon: 5
- Seed: 1729
- Drawdown limit: 0.10
- Drawdown probability: 0.0
- Loss p50: 0.3339
- Loss p95: 3.9585

## Limitations

- The sample series is a deterministic up-and-down fixture, not a market history.
- Kronos weights are not loaded. A checkpoint path does not enable that model.
- The advisory note does not change a hard limit.
- The monitor disables the signal when the mean absolute log error is above 0.20.

**Approval:** Pending model owner review.
