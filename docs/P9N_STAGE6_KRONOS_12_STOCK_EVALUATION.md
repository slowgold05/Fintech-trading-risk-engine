# P9N — Stage 6 Kronos evaluation, 12 featured stocks

Record of the one official walk-forward run for roadmap Stage 6, step 3.
The run happened once, on 15 November 2026. Weak and negative results are
the record. It was not repeated.

## Method

The featured list is `FEATURED_FORECAST_SYMBOLS` in `app/core/config.py`,
chosen by the user on 2026-11-15:

AAPL, MSFT, NVDA, AMZN, GOOGL, JPM, JNJ, XOM, PG, CAT, HD, NEE.

`require_featured_forecast_symbol` rejects every other symbol. That check
runs in `POST /forecasts/jobs` after the unknown-symbol check, in
`generate_forecast` before a history read, and in
`app/scripts/run_forecast_evaluation.py` before a database session is
opened.

Each stock was scored by its own process:

```
python -m app.scripts.run_forecast_evaluation --symbol SYM --horizon 10 --window-count 5 --provider massive --adjustment-type raw
```

The process is not the API. `FORECAST_KRONOS_ENABLED` was set false in
that process. The script calls `generate_forecast` directly. It writes one
`ForecastEvaluation` row and does not write a `ForecastResult`.

`run_walk_forward_evaluation` takes five non-overlapping windows, newest
first. The first cutoff leaves the last 10 sessions as the actual future.
Each next cutoff moves back 10 sessions. Window count 5 is the script
default and was fixed before any of these metrics were known.

For each window the baseline path is the last observed close repeated for
the 10 sessions (`last_observed_close`). MAE is the mean absolute error of
the close, in that symbol's price units. Directional accuracy is the hit
rate of each session's sign against the previous actual close, starting
from the cutoff close. The baseline's predicted level stays at the cutoff
close for all 10 sessions, so its direction on later sessions is the sign
from the previous actual close back toward that cutoff.

The forecaster sets `as_of` to the last observed session and asks
`generate_forecast` for `lookback = min(observed bars, 400)`, `horizon = 10`,
and `sample_count = 1`. `generate_forecast` re-reads
`read_symbol_history` for the `2y` range, whose end is the PostgreSQL
transaction clock, then keeps bars with `session_date <= as_of` and uses
the last 400 of those. That is the current cache filtered at the cutoff.
It is not a reconstruction of the data as it stood on the cutoff date.
The same limit is already stated in
[P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md](P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md)
and [FORECAST_LAB_OPEN_LIMITATIONS.md](FORECAST_LAB_OPEN_LIMITATIONS.md).

On this cache every window has 450 to 490 observed bars, so the lookback
is 400 for every window. `predict` uses its defaults: `T=1.0`, `top_k=0`,
`top_p=0.9`. No seed was passed. Each window is one stochastic sample.
The close used for MAE is the model's close. The high/low envelope clamp
from [P9F_KRONOS_OHLC_CLAMP_VERIFICATION.md](P9F_KRONOS_OHLC_CLAMP_VERIFICATION.md)
does not change open or close.

`review_status` is not set by the script. The column server default is
`pending`, and the app role's INSERT grant omits the column. Each row's
note is `Model-owner review: PENDING (user). Walk-forward result only. Not a published forecast.`

## Data window and coverage

Local Postgres at `127.0.0.1:5433`, database `fintechapp`. Canonical bars
are `provider = massive`, `adjustment_type = raw`, `quality_status = valid`.

All 12 symbols are active. Each has 500 valid bars and no other raw
Massive rows. The 12 symbols share the same 500 sessions, from
2024-11-15 through 2026-11-13. The `2y` history read on the run date
starts at 2024-11-15, so it includes that whole series before the cutoff
filter.

The five cutoffs are the same for every symbol, newest first:
2026-10-30, 2026-10-16, 2026-10-02, 2026-09-18, 2026-09-03.

Rows were inserted from 2026-11-16 04:03:23 UTC through 2026-11-16
04:04:27 UTC (2026-11-15 23:03:23 through 23:04:27 Eastern). Local
evaluation ids are 1 through 12, in the symbol order above. Alembic
revision `a6c3e840b912` (review-status column) was applied to this local
database before the run. Hosted databases were not migrated here.

## Model versions and commit

| Item | Value |
| --- | --- |
| Parent commit at run time | `240d2145947cd841c5309656b56d27e3316f5cf0` (`Add Massive as an end-of-day quote-cache source (#135)`) |
| Evaluation-code commit | `728e5dfc4d48414d7e565ba1528e30375d748ace` |
| Python | 3.11.9, the existing forecast virtualenv |
| pandas | 2.2.2 |
| numpy | 1.26.4 |
| torch | 2.5.1+cpu (`torch.cuda.is_available()` is false) |
| einops | 0.8.1 |
| huggingface_hub | 0.33.1 |
| safetensors | 0.6.2 |
| Model | `NeoQuasar/Kronos-small`, cached snapshot `901c26c1332695a2a8f243eb2f37243a37bea320` |
| Tokenizer | `NeoQuasar/Kronos-Tokenizer-base`, cached snapshot `0e0117387f39004a9016484a186a908917e22426` |
| Dependency pins | `requirements-forecast.txt` (`torch>=2.2,<2.6`, `numpy>=1.26,<2`) |

The scored run executed the worktree recorded by commit
`728e5dfc4d48414d7e565ba1528e30375d748ace`. A follow-up commit only replaces that
identifier. Weights were already cached
under `var/kronos` (gitignored). Windows cached the Hugging Face files
without symlinks. That warning did not stop the run. `weights_exercised`
is true on all 12 rows.

`FORECAST_KRONOS_ENABLED` is unset in the local `.env` and defaults to
false in `app/core/config.py`. The run forced it false again. It is still
false.

## Runtime and resources

Twelve processes ran one after another. Wall clock for the whole pass was
**70.152 seconds**. Per-symbol wall clock was 5.702 to 6.019 seconds.
The script's own timers sum to 57.572 seconds. The machine has 32 logical
processors. CPU seconds for the scored processes were not captured.

The sampler inside that pass called `GetProcessMemoryInfo` without a
64-bit argument prototype and reported a peak of 5,033,984 bytes. That
figure is not a torch working set, and it is not used.

A later sample, in a new process of the same interpreter, loaded the same
cached weights and ran one `generate_forecast` for AAPL (`as_of`
2026-10-30, lookback 400, horizon 10, `sample_count` 1). It wrote nothing:
`forecast_evaluations` stayed at 12 rows and `forecast_results` stayed at
0. With the API prototype set, that process reported:

| Counter | Bytes | |
| --- | ---: | --- |
| Peak working set | 502,837,248 | 479.5 MiB |
| Working set after the call | 482,488,320 | 460.1 MiB |
| Peak pagefile | 1,428,520,960 | 1.33 GiB |
| Pagefile after the call | 1,324,457,984 | 1.23 GiB |

That sample took 2.595 seconds and is not a scored window. Each scored
process ran five windows in one loaded interpreter, so its working set
should be in this neighborhood. The 479.5 MiB figure is the measured
sample, not a reading taken from the twelve scored processes.

## Results

MAE is in price units. A dollar of error on CAT is not the same relative
miss as a dollar on NEE. The ratio is that symbol's model MAE divided by
its baseline MAE. The unweighted mean of the 12 stored stock MAEs is also
the unweighted mean of all 60 window MAEs, because every stock has five
windows. Tables round MAE to six decimal places and direction to two.
The database holds the exact floats.

The baseline MAE is lower for 10 of the 12 stocks. JPM (ratio 0.951) and
NEE (ratio 0.739) are the two where the model MAE is lower. JPM's
direction is worse than the baseline (0.52 versus 0.54). NEE is the only
symbol better on both MAE and direction. Across the 60 windows the model
MAE is lower on 18 and the baseline MAE is lower on 42.

Direction is mixed. The unweighted mean of the stored stock-level rates
is 0.5167 for the model and 0.4700 for the baseline. The model rate is
higher for 7 stocks, lower for 4 (AAPL, JPM, XOM, CAT), and tied for MSFT.
MSFT's stored floats are `0.54` and `0.5399999999999999`; both are the
mean of window rates that sum to 2.7. Of 60 windows, the model direction
is higher on 27, lower on 15, and tied on 18.

| Symbol | Model MAE | Baseline MAE | Ratio | Model direction | Baseline direction | Wall s | Script s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AAPL | 31.439142 | 5.017900 | 6.265 | 0.48 | 0.50 | 6.008 | 4.914 |
| MSFT | 17.566952 | 11.703700 | 1.501 | 0.54 | 0.54 | 5.702 | 4.719 |
| NVDA | 16.625347 | 9.871200 | 1.684 | 0.44 | 0.40 | 5.788 | 4.749 |
| AMZN | 9.742086 | 8.702800 | 1.119 | 0.64 | 0.52 | 5.812 | 4.750 |
| GOOGL | 16.702715 | 9.804700 | 1.704 | 0.56 | 0.42 | 5.727 | 4.741 |
| JPM | 6.359040 | 6.685400 | 0.951 | 0.52 | 0.54 | 6.019 | 4.869 |
| JNJ | 16.072338 | 6.800400 | 2.363 | 0.52 | 0.42 | 5.855 | 4.820 |
| XOM | 10.728194 | 6.466200 | 1.659 | 0.40 | 0.44 | 5.725 | 4.748 |
| PG | 8.123044 | 3.425400 | 2.371 | 0.56 | 0.52 | 5.875 | 4.843 |
| CAT | 66.132966 | 29.740600 | 2.224 | 0.42 | 0.48 | 5.860 | 4.797 |
| HD | 23.693937 | 12.097400 | 1.959 | 0.50 | 0.44 | 5.814 | 4.777 |
| NEE | 1.727463 | 2.336000 | 0.739 | 0.62 | 0.42 | 5.968 | 4.845 |
| Equal-weight mean | 18.742769 | 9.387642 | 2.045 | 0.5167 | 0.4700 |  |  |

Stored means used for that last row: model MAE `18.7427687983195`,
baseline MAE `9.387641666666669`, mean ratio `2.045039302324139`,
model direction `0.5166666666666667`, baseline direction `0.47`.

### Per-window record

Printed by the run, six decimal places for MAE.

| Symbol | Cutoff | Model MAE | Baseline MAE | Model direction | Baseline direction |
| --- | --- | ---: | ---: | ---: | ---: |
| AAPL | 2026-10-30 | 31.771312 | 6.947000 | 0.60 | 0.50 |
| AAPL | 2026-10-16 | 32.450363 | 2.511500 | 0.60 | 0.50 |
| AAPL | 2026-10-02 | 31.846185 | 5.573000 | 0.30 | 0.40 |
| AAPL | 2026-09-18 | 36.293142 | 3.287000 | 0.50 | 0.70 |
| AAPL | 2026-09-03 | 24.834708 | 6.771000 | 0.40 | 0.40 |
| MSFT | 2026-10-30 | 22.436497 | 11.068500 | 0.60 | 0.70 |
| MSFT | 2026-10-16 | 13.406574 | 3.972000 | 0.60 | 0.80 |
| MSFT | 2026-10-02 | 27.902297 | 15.340000 | 0.30 | 0.30 |
| MSFT | 2026-09-18 | 11.110176 | 13.791000 | 0.60 | 0.50 |
| MSFT | 2026-09-03 | 12.979218 | 14.347000 | 0.60 | 0.40 |
| NVDA | 2026-10-30 | 37.132235 | 22.305000 | 0.30 | 0.40 |
| NVDA | 2026-10-16 | 9.765498 | 3.512000 | 0.60 | 0.50 |
| NVDA | 2026-10-02 | 4.966717 | 8.415000 | 0.50 | 0.30 |
| NVDA | 2026-09-18 | 23.447835 | 5.797000 | 0.30 | 0.30 |
| NVDA | 2026-09-03 | 7.814448 | 9.327000 | 0.50 | 0.50 |
| AMZN | 2026-10-30 | 22.894413 | 21.643000 | 0.50 | 0.40 |
| AMZN | 2026-10-16 | 10.831121 | 6.430000 | 0.40 | 0.60 |
| AMZN | 2026-10-02 | 6.062368 | 4.913000 | 0.70 | 0.60 |
| AMZN | 2026-09-18 | 4.485770 | 4.565000 | 0.80 | 0.70 |
| AMZN | 2026-09-03 | 4.436759 | 5.963000 | 0.80 | 0.30 |
| GOOGL | 2026-10-30 | 8.083158 | 8.205000 | 0.70 | 0.40 |
| GOOGL | 2026-10-16 | 38.300242 | 22.350500 | 0.30 | 0.30 |
| GOOGL | 2026-10-02 | 8.198209 | 5.937000 | 0.50 | 0.30 |
| GOOGL | 2026-09-18 | 18.529971 | 6.977000 | 0.70 | 0.60 |
| GOOGL | 2026-09-03 | 10.401996 | 5.554000 | 0.60 | 0.50 |
| JPM | 2026-10-30 | 6.286307 | 5.375000 | 0.60 | 0.60 |
| JPM | 2026-10-16 | 8.892576 | 4.307000 | 0.40 | 0.70 |
| JPM | 2026-10-02 | 3.085357 | 2.173000 | 0.60 | 0.50 |
| JPM | 2026-09-18 | 3.185746 | 12.229000 | 0.70 | 0.40 |
| JPM | 2026-09-03 | 10.345216 | 9.343000 | 0.30 | 0.50 |
| JNJ | 2026-10-30 | 20.261651 | 6.326000 | 0.50 | 0.50 |
| JNJ | 2026-10-16 | 19.237389 | 10.476000 | 0.40 | 0.40 |
| JNJ | 2026-10-02 | 7.203330 | 3.309000 | 0.50 | 0.60 |
| JNJ | 2026-09-18 | 16.879278 | 3.898000 | 0.60 | 0.20 |
| JNJ | 2026-09-03 | 16.780043 | 9.993000 | 0.60 | 0.40 |
| XOM | 2026-10-30 | 13.902704 | 17.865000 | 0.50 | 0.40 |
| XOM | 2026-10-16 | 15.957070 | 2.980000 | 0.20 | 0.40 |
| XOM | 2026-10-02 | 14.239821 | 6.679000 | 0.30 | 0.30 |
| XOM | 2026-09-18 | 3.202726 | 2.148000 | 0.50 | 0.60 |
| XOM | 2026-09-03 | 6.338647 | 2.659000 | 0.50 | 0.50 |
| PG | 2026-10-30 | 14.833960 | 5.222000 | 0.40 | 0.40 |
| PG | 2026-10-16 | 14.477313 | 1.735000 | 0.60 | 0.60 |
| PG | 2026-10-02 | 7.184640 | 7.409000 | 0.20 | 0.20 |
| PG | 2026-09-18 | 2.281556 | 1.361000 | 0.80 | 0.80 |
| PG | 2026-09-03 | 1.837751 | 1.400000 | 0.80 | 0.60 |
| CAT | 2026-10-30 | 141.251951 | 29.821000 | 0.50 | 0.60 |
| CAT | 2026-10-16 | 65.868392 | 35.525000 | 0.50 | 0.50 |
| CAT | 2026-10-02 | 51.405086 | 58.609000 | 0.30 | 0.20 |
| CAT | 2026-09-18 | 58.957586 | 11.205000 | 0.40 | 0.60 |
| CAT | 2026-09-03 | 13.181815 | 13.543000 | 0.40 | 0.50 |
| HD | 2026-10-30 | 41.311820 | 18.434000 | 0.50 | 0.50 |
| HD | 2026-10-16 | 38.524469 | 10.401000 | 0.50 | 0.50 |
| HD | 2026-10-02 | 9.447606 | 11.264000 | 0.60 | 0.40 |
| HD | 2026-09-18 | 11.369169 | 9.816000 | 0.40 | 0.40 |
| HD | 2026-09-03 | 17.816623 | 10.572000 | 0.50 | 0.40 |
| NEE | 2026-10-30 | 1.996415 | 2.544000 | 0.60 | 0.80 |
| NEE | 2026-10-16 | 1.641742 | 2.082000 | 0.60 | 0.40 |
| NEE | 2026-10-02 | 0.952953 | 1.263000 | 0.60 | 0.30 |
| NEE | 2026-09-18 | 2.870089 | 3.679000 | 0.60 | 0.40 |
| NEE | 2026-09-03 | 1.176118 | 2.112000 | 0.70 | 0.20 |

## Model-owner review: PENDING (user)

No named reviewer has accepted this evaluation. All 12 local rows have
`review_status = pending`. Stage 6's exit gate requires that sign-off.
This document does not provide it.

Until a reviewer sets the latest row for a symbol to `approved`,
`publish_forecast_result` rejects that symbol with "An unreviewed
evaluation cannot reach a publish path." `forecast_publish_paths` lists
that function as the only writer of a `ForecastResult`. The forecast
worker still refuses to run while `forecast_kronos_enabled` is false, so
both gates are closed.

Steps 4, 5, and 6 stay open: named model-owner review, scheduled
precompute of 10-session forecasts, and publishing reviewed outputs.
Precompute was not scheduled. No forecast was published.

## Checks

Focused pytest, from this worktree, using the forecast virtualenv:
`tests/test_forecast_featured_scope.py`, `tests/test_forecast_jobs.py`,
`tests/test_forecast_worker.py`, `tests/test_forecast_evaluation.py`,
and `tests/test_forecast_kronos.py`. Result: 54 passed.

The PostgreSQL grant, claim, and admission tests were updated so a
featured symbol is seeded when `AUDIT_DATABASE_URL` is set. They were
not executed here. Default CI skips them when that URL is unset.

The API on port 8000, the frontend on port 5173, and the local Postgres
container were left running.
