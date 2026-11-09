# SM-FC-02 model card

**Status:** Draft. Pending model owner review.

## Purpose

Produce one bounded path of future daily bars from the most recent cached sessions for a symbol. The output is not an approved signal and cannot feed a risk rule.

## Data

Price input is the cached daily window from `read_symbol_history` (`interval` `1d`, `range` `2y`). No live vendor call is made for prices. The vendored Kronos source is commit `67b630e67f6a18c9e9be918d9b4337c960db1e9a`. Weight repository names are pinned in settings as `NeoQuasar/Kronos-small` and `NeoQuasar/Kronos-Tokenizer-base`. This card was produced from a synthetic fixture. No Hugging Face Hub request was made, and real weights were not exercised.

## Version

Version 1. The implementation is `app.services.forecast_kronos`. There is no weight file in this validation.

## Owner

Market Risk, pending confirmation. Approval is pending model owner review.

## Limitations

- No walk-forward accuracy evaluation has been performed.
- Real model weights were not downloaded or exercised in this environment.
- The recorded checks are shape and guard validation only.
- `sample_count` asks Kronos to average internal samples into one path. This unit does not return an ensemble of paths.

## Approved uses

None. Pending model owner review.

## Prohibited uses

- Placing an order.
- Changing a hard position, concentration, buying-power, or price-band limit.
- Treating this shape check as validated forecasting accuracy.
- Claiming a walk-forward evaluation has been performed.
