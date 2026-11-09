# SM-FC-02 validation report

**Model:** Kronos bounded daily forecast version 1
**Type:** foundation_timeseries
**Owner:** Market Risk (pending confirmation)
**Status:** Draft. Pending model owner review. This report is not an activation.

## Principle

The check follows the SR 11-7 idea that a model is inventoried and validated before a risk rule uses it. The checks below come from a synthetic cached-bar fixture exercised through `app.services.forecast_kronos`. They cover bounds rejection, point-in-time windowing, and output shape. They are not a hit rate, and they are not an accuracy number. No walk-forward evaluation has been performed.

## Bounds rejection

Each over-limit call must raise `ValueError` before `read_symbol_history` runs. Configured maxima are lookback 400, horizon 30, and sample count 5.

- Lookback over the max rejected before a history read: yes
- Horizon over the max rejected before a history read: yes
- Sample count over the max rejected before a history read: yes
- Fewer cached sessions than the requested lookback rejected: yes

## Point-in-time window

Future dates come from `exchange_calendar.is_nyse_trading_day`, walked one calendar day at a time. The two reference vectors below were checked by calling that function, not by assuming a calendar.

- Reference vectors matched: yes
- `2026-11-06` plus 3 sessions: 2026-11-09, 2026-11-10, 2026-11-11.
- `2026-11-25` plus 3 sessions: 2026-11-27, 2026-11-30, 2026-12-01. Thanksgiving, 2026-11-26, is skipped.
- Fixture length: 8 synthetic sessions ending 2026-11-06.
- Requested lookback: 3. The predictor received the tail, starting 2026-11-04.
- Input cutoff: 2026-11-06.
- Future sessions passed as `y_timestamp` and returned on the bars: 2026-11-09, 2026-11-10, 2026-11-11.

## Output shape

A fake predictor returned one row per requested session. Real weights were not downloaded and `predict` on the vendored model was not called.

- Output shape matched the requested horizon: yes
- Horizon: 3
- Sample count forwarded to the fake predictor: 2
- The returned object is one path. `sample_count` is the count Kronos would average internally. This check does not produce several scenario paths.

## Limitations

- The fixture is synthetic cached-bar text. It is not a market history.
- No walk-forward accuracy evaluation has been performed.
- Real Kronos weights were not downloaded or exercised. This is shape and guard validation only.
- Nothing in this report is a hit rate or an accuracy number.
- The advisory output cannot change a hard limit or place an order.

**Approval:** Pending model owner review.
