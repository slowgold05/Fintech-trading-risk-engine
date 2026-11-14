# SM-FC-01 model card

**Status:** Draft. Pending model owner review.

## Purpose

Estimate a one-step price band from the trailing sample standard deviation of log returns, and show a seeded loss distribution. The output is an advisory signal.

## Data

The stored report uses `sample_closes`, a 41-point alternating 1 percent fixture. A caller can pass other closes. No vendor was called to produce this card.

## Version

Version 1. The implementation is `app.services.forecast`. There is no weight file.

## Owner

Market Risk. Approval is pending model owner review.

## Limitations

- The band assumes the recent log-return dispersion continues for the horizon.
- The drawdown probability is a seeded simulation, not a Kronos forecast.
- A disabled monitor or a failed validation returns no signal.

## Approved uses

None. Pending model owner review.

## Prohibited uses

- Changing a hard position, concentration, buying-power, or price-band limit.
- Placing an order.
- Treating the fixture hit rate as production accuracy.
- Loading or claiming a Kronos checkpoint in this build.
