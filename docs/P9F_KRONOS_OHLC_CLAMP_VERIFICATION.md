# Stage 6 follow-up — widen raw Kronos OHLC to a consistent envelope

Follows directly from the real finding in
[P9E_STAGE6_KRONOS_REAL_INFERENCE_VERIFICATION.md](P9E_STAGE6_KRONOS_REAL_INFERENCE_VERIFICATION.md):
a real inference run showed 1 of 10 raw forecast bars with `open > high`
— the model is a generative sampler with no hard OHLC-ordering
guarantee. Flagged there as a real, open gap, not fixed in that unit.
This unit closes it.

## The fix

`app/services/forecast_kronos.py::generate_forecast`'s `forecast_bars`
construction now computes `high = max(open, high, low, close)` and
`low = min(open, high, low, close)` over the model's own four raw
values, instead of using the model's raw `high`/`low` fields directly.
**`open` and `close` are never altered** — only the high/low envelope is
corrected to actually contain all four raw values, which is what
`high`/`low` are supposed to mean by definition. This is the smallest
possible intervention: it does not fabricate a materially different
price, does not clamp the model's point predictions toward some
assumed "correct" value, and does not change behavior at all for any
bar where the raw output already happened to be self-consistent
(confirmed: every existing test's fixture data was already consistent,
so this fix is a no-op for all of them).

## Verification

- New test, `test_generate_forecast_widens_high_low_to_the_raw_envelope`:
  a deliberately inconsistent fake predictor (`open=192.0, high=191.8`,
  reproducing the exact shape seen in the real run) confirms `high` is
  widened to `192.0` and `low <= open/close <= high` holds; a second,
  already-consistent bar in the same response confirms the fix is a
  no-op where nothing needs correcting.
- `tests/test_forecast_kronos.py`: **13 passed** (the 12 from before
  plus this new one).
- **Reran the exact real inference call from the earlier unit, same
  `seed=42`, same synthetic input:** the same first bar that previously
  showed `open=192.02, high=191.84` (a violation) now shows
  `open=192.02, high=192.02` (widened, zero violations) — the fix
  confirmed against the real model, not just a mocked fixture.
- Full backend suite: **548 passed, 44 skipped, zero failures.**

## What this does not do

Does not change `open`/`close` — the model's own point predictions are
untouched. Does not retroactively fix anything already stored (nothing
has ever been stored from a real Kronos call — `FORECAST_KRONOS_ENABLED`
is still `false` everywhere). Does not constitute model-owner review or
a forecast-quality claim — this is a structural consistency fix to the
function's own output contract, independent of whether the model's
predictions are any good.
