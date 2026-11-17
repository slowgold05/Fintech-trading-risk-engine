# P9N — Stage 6 Kronos evaluation, 12 featured stocks

Record of the official walk-forward run for roadmap Stage 6, step 3. It
scored the `split_adjusted` Massive series on 16 November 2026. Weak and
negative results are the record. The run was not repeated or tuned.

An earlier pass on 15 November scored the `raw` series. It is kept below
under "Superseded raw run" and is not the official result.

## Method

The featured list is `FEATURED_FORECAST_SYMBOLS` in `app/core/config.py`,
chosen by the user on 2026-11-15:

AAPL, MSFT, NVDA, AMZN, GOOGL, JPM, JNJ, XOM, PG, CAT, HD, NEE.

`require_featured_forecast_symbol` rejects every other symbol. That check
runs in `POST /forecasts/jobs` after the unknown-symbol check, in
`generate_forecast` before a history read, and in
`app/scripts/run_forecast_evaluation.py` before a database session is
opened.

Each stock was scored by its own process, one after another:

```
python -m app.scripts.run_forecast_evaluation --symbol SYM --horizon 10 --window-count 5 --provider massive --adjustment-type split_adjusted --seed 0
```

The script accepts only `split_adjusted`. A raw series steps at every
split, and that step would be scored as a forecast miss. Before scoring,
the script requires two things of the series, or it writes nothing:

- `_require_complete_coverage`: every standard NYSE session between the
  first and last valid bar is present. The one-off 2025-01-09 closure
  recorded in `OBSERVED_CLOSED_SESSIONS` is not a session.
- `_require_current`: the series ends on the newest session stored for
  that symbol and provider in any adjustment, so a backfill that is still
  running cannot move every cutoff earlier.

The process is not the API. `FORECAST_KRONOS_ENABLED` was set false in
that process and `HF_HUB_OFFLINE=1` was set, so only cached weights were
read. The script calls `generate_forecast` directly. It writes one
`ForecastEvaluation` row and does not write a `ForecastResult`.

`run_walk_forward_evaluation` takes five non-overlapping windows, newest
first. The first cutoff leaves the last 10 sessions as the actual future.
Each next cutoff moves back 10 sessions. Window count 5 is the script
default and was fixed before any of these metrics were known.

For each window the baseline path is the last observed close repeated for
the 10 sessions (`last_observed_close`). MAE is the mean absolute error of
the close, in that symbol's price units. Directional accuracy is the hit
rate of each session's sign against the previous actual close, starting
from the cutoff close. The window scorer refuses a forecaster output whose
length differs from the actual path or that holds a non-finite value.

The forecaster sets `as_of` to the last observed session and asks
`generate_forecast` for `lookback = min(observed bars, 400)`, `horizon = 10`,
and `sample_count = 1`. It refuses a result whose `input_cutoff` is not
that session. `generate_forecast` re-reads `read_symbol_history` for the
`2y` range, then keeps bars with `session_date <= as_of` and uses the last
400 of those. That is the current cache filtered at the cutoff. It is not
a reconstruction of the data as it stood on the cutoff date. The same
limit is stated in
[P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md](P6F_KRONOS_POINT_IN_TIME_VERIFICATION.md)
and [FORECAST_LAB_OPEN_LIMITATIONS.md](FORECAST_LAB_OPEN_LIMITATIONS.md).

Every window has at least 449 observed bars, so the lookback is 400 for
every window. `predict` uses its defaults: `T=1.0`, `top_k=0`, `top_p=0.9`.
The torch seed was 0, set before every window. Each window is one sample.

`review_status` is not set by the script. The column server default is
`pending`, and the app role's INSERT grant omits the column. Each row's
note is `Model-owner review: PENDING (user). Walk-forward result only. Not a published forecast.`

## Data window and coverage

Local Postgres at `127.0.0.1:5433`, database `fintechapp`. Scored bars are
`provider = massive`, `adjustment_type = split_adjusted`,
`quality_status = valid`.

Each of the 12 symbols has 499 valid split-adjusted bars, from 2024-11-18
through 2026-11-13, with no missing NYSE session in that span and no
flagged or rejected bar. The last bar equals the newest Massive bar stored
for the symbol in any series. Coverage was checked read-only before the
run and again by the backfill session. The 2026-11-16 session was not
ingested: Massive still reported that grouped day as `DELAYED`, which the
parser rejects.

The five cutoffs are the same for every symbol, newest first:
2026-10-30, 2026-10-16, 2026-10-02, 2026-09-18, 2026-09-03.

No split falls inside any evaluation window for these 12 stocks. The
actual closes, and so the baseline MAE and direction, are identical to the
raw pass. Only the model's input history differs.

Rows were inserted from 2026-11-17 04:01:18 UTC through 04:02:17 UTC
(2026-11-16 23:01:18 through 23:02:17 Eastern). Local evaluation ids are
13 through 24, in the symbol order above. Hosted databases were not
touched.

## Model versions and commit

| Item | Value |
| --- | --- |
| Evaluation-code commit | `fc5c3c1405472f5da99400d8efd22d5c272bf1dc` (clean worktree at run time) |
| Python | 3.11.9, a fresh virtualenv built from `requirements.txt` and `requirements-forecast.txt` |
| pandas | 2.2.2 |
| numpy | 1.26.4 |
| torch | 2.5.1+cpu |
| einops | 0.8.1 |
| huggingface_hub | 0.33.1 |
| safetensors | 0.6.2 |
| Model | `NeoQuasar/Kronos-small`, cached snapshot `901c26c1332695a2a8f243eb2f37243a37bea320` |
| Tokenizer | `NeoQuasar/Kronos-Tokenizer-base`, cached snapshot `0e0117387f39004a9016484a186a908917e22426` |
| Dependency pins | `requirements-forecast.txt` (`torch>=2.2,<2.6`, `numpy>=1.26,<2`) |

Weights were read from the existing cache under `var/kronos` in the main
checkout (gitignored). `weights_exercised` is true on all 12 rows.

`FORECAST_KRONOS_ENABLED` is unset in the local `.env` and defaults to
false in `app/core/config.py`. The run forced it false again. It is still
false.

## Runtime and resources

Twelve processes ran one after another on CPU. Wall clock for the whole
pass was **65.007 seconds**. Per-symbol wall clock was 5.273 to 5.740
seconds. The script's own timers sum to 52.571 seconds. CPU seconds
(user plus system) per process were 47.3 to 52.4, so torch used several
cores. Peak working set per process, read with `K32GetProcessMemoryInfo`,
was 474.0 to 475.3 MiB.

## Results

MAE is in price units. A dollar of error on CAT is not the same relative
miss as a dollar on NEE. The ratio is that symbol's model MAE divided by
its baseline MAE. Tables round MAE to six decimal places and direction to
two. The database holds the exact floats.

**The model does not beat the naive baseline on error.** The baseline MAE
is lower for 10 of the 12 stocks. AMZN (ratio 0.904) and JPM (0.879) are
the two where the model MAE is lower. Across the 60 windows the model MAE
is lower on 14 and the baseline MAE is lower on 46. The unweighted mean
model MAE is 16.979887 against 9.387642 for the baseline, a ratio of 1.81.
The mean of the per-stock ratios is 1.99.

Direction is slightly better than the baseline but close to a coin flip.
The unweighted mean of the stock-level rates is 0.5183 for the model and
0.4700 for the baseline. The model rate is higher for 7 stocks, lower for
2 (MSFT, CAT), and tied for 3 (AAPL, JPM, XOM). Of 60 windows, the model
direction is higher on 28, lower on 19, and tied on 13. Five 10-session
windows per stock is a small sample. These direction gaps are not shown
to be significant.

AAPL is the worst case (ratio 6.40). In all five windows the first
predicted close is near the cutoff close, and the path then drifts down
by roughly 10% over 10 sessions while the actual price held or rose. The
mean signed error per AAPL window is -26 to -37 dollars. PG shows the same
downward drift in its two newest windows. CAT's two newest windows drift
up by about 100 dollars against a falling price.

| Symbol | Model MAE | Baseline MAE | Ratio | Model direction | Baseline direction | Wall s | Script s | CPU s | Peak MiB | Id |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AAPL | 32.094889 | 5.017900 | 6.396 | 0.50 | 0.50 | 5.414 | 4.423 | 48.00 | 475.1 | 13 |
| MSFT | 16.653034 | 11.703700 | 1.423 | 0.50 | 0.54 | 5.273 | 4.287 | 47.53 | 474.4 | 14 |
| NVDA | 14.529144 | 9.871200 | 1.472 | 0.56 | 0.40 | 5.385 | 4.333 | 47.88 | 475.3 | 15 |
| AMZN | 7.867467 | 8.702800 | 0.904 | 0.56 | 0.52 | 5.499 | 4.396 | 48.47 | 474.1 | 16 |
| GOOGL | 16.252049 | 9.804700 | 1.658 | 0.56 | 0.42 | 5.460 | 4.356 | 47.92 | 474.8 | 17 |
| JPM | 5.875603 | 6.685400 | 0.879 | 0.54 | 0.54 | 5.740 | 4.675 | 52.38 | 474.0 | 18 |
| JNJ | 16.210519 | 6.800400 | 2.384 | 0.46 | 0.42 | 5.520 | 4.444 | 49.12 | 474.8 | 19 |
| XOM | 11.429875 | 6.466200 | 1.768 | 0.44 | 0.44 | 5.375 | 4.345 | 48.11 | 474.4 | 20 |
| PG | 9.393910 | 3.425400 | 2.742 | 0.56 | 0.52 | 5.288 | 4.288 | 47.27 | 474.8 | 21 |
| CAT | 57.768635 | 29.740600 | 1.942 | 0.46 | 0.48 | 5.365 | 4.357 | 48.02 | 474.8 | 22 |
| HD | 12.744801 | 12.097400 | 1.054 | 0.52 | 0.44 | 5.344 | 4.329 | 47.61 | 474.1 | 23 |
| NEE | 2.938722 | 2.336000 | 1.258 | 0.56 | 0.42 | 5.335 | 4.340 | 47.59 | 474.3 | 24 |
| Equal-weight mean | 16.979887 | 9.387642 | 1.809 | 0.5183 | 0.4700 |  |  |  |  |  |

### Per-window record

From each process's `--report-json` output, six decimal places for MAE.

| Symbol | Cutoff | Model MAE | Baseline MAE | Model direction | Baseline direction |
| --- | --- | ---: | ---: | ---: | ---: |
| AAPL | 2026-10-30 | 37.355310 | 6.947000 | 0.60 | 0.50 |
| AAPL | 2026-10-16 | 30.327380 | 2.511500 | 0.60 | 0.50 |
| AAPL | 2026-10-02 | 30.638754 | 5.573000 | 0.30 | 0.40 |
| AAPL | 2026-09-18 | 34.876931 | 3.287000 | 0.50 | 0.70 |
| AAPL | 2026-09-03 | 27.276070 | 6.771000 | 0.50 | 0.40 |
| MSFT | 2026-10-30 | 19.935340 | 11.068500 | 0.50 | 0.70 |
| MSFT | 2026-10-16 | 14.326808 | 3.972000 | 0.70 | 0.80 |
| MSFT | 2026-10-02 | 27.835985 | 15.340000 | 0.40 | 0.30 |
| MSFT | 2026-09-18 | 14.104131 | 13.791000 | 0.40 | 0.50 |
| MSFT | 2026-09-03 | 7.062906 | 14.347000 | 0.50 | 0.40 |
| NVDA | 2026-10-30 | 28.412733 | 22.305000 | 0.30 | 0.40 |
| NVDA | 2026-10-16 | 4.316236 | 3.512000 | 0.80 | 0.50 |
| NVDA | 2026-10-02 | 10.770392 | 8.415000 | 0.80 | 0.30 |
| NVDA | 2026-09-18 | 18.767194 | 5.797000 | 0.30 | 0.30 |
| NVDA | 2026-09-03 | 10.379165 | 9.327000 | 0.60 | 0.50 |
| AMZN | 2026-10-30 | 17.483393 | 21.643000 | 0.40 | 0.40 |
| AMZN | 2026-10-16 | 7.050743 | 6.430000 | 0.50 | 0.60 |
| AMZN | 2026-10-02 | 6.159587 | 4.913000 | 0.50 | 0.60 |
| AMZN | 2026-09-18 | 5.137311 | 4.565000 | 0.80 | 0.70 |
| AMZN | 2026-09-03 | 3.506302 | 5.963000 | 0.60 | 0.30 |
| GOOGL | 2026-10-30 | 19.764325 | 8.205000 | 0.60 | 0.40 |
| GOOGL | 2026-10-16 | 34.399247 | 22.350500 | 0.40 | 0.30 |
| GOOGL | 2026-10-02 | 8.821348 | 5.937000 | 0.50 | 0.30 |
| GOOGL | 2026-09-18 | 10.853614 | 6.977000 | 0.70 | 0.60 |
| GOOGL | 2026-09-03 | 7.421710 | 5.554000 | 0.60 | 0.50 |
| JPM | 2026-10-30 | 5.238363 | 5.375000 | 0.60 | 0.60 |
| JPM | 2026-10-16 | 3.925373 | 4.307000 | 0.60 | 0.70 |
| JPM | 2026-10-02 | 3.482540 | 2.173000 | 0.30 | 0.50 |
| JPM | 2026-09-18 | 3.602150 | 12.229000 | 0.70 | 0.40 |
| JPM | 2026-09-03 | 13.129588 | 9.343000 | 0.50 | 0.50 |
| JNJ | 2026-10-30 | 23.198156 | 6.326000 | 0.40 | 0.50 |
| JNJ | 2026-10-16 | 13.877772 | 10.476000 | 0.30 | 0.40 |
| JNJ | 2026-10-02 | 7.800829 | 3.309000 | 0.40 | 0.60 |
| JNJ | 2026-09-18 | 18.120327 | 3.898000 | 0.60 | 0.20 |
| JNJ | 2026-09-03 | 18.055509 | 9.993000 | 0.60 | 0.40 |
| XOM | 2026-10-30 | 7.872568 | 17.865000 | 0.60 | 0.40 |
| XOM | 2026-10-16 | 22.480695 | 2.980000 | 0.30 | 0.40 |
| XOM | 2026-10-02 | 15.797384 | 6.679000 | 0.30 | 0.30 |
| XOM | 2026-09-18 | 5.843589 | 2.148000 | 0.30 | 0.60 |
| XOM | 2026-09-03 | 5.155138 | 2.659000 | 0.70 | 0.50 |
| PG | 2026-10-30 | 22.397676 | 5.222000 | 0.40 | 0.40 |
| PG | 2026-10-16 | 14.865946 | 1.735000 | 0.60 | 0.60 |
| PG | 2026-10-02 | 6.906476 | 7.409000 | 0.40 | 0.20 |
| PG | 2026-09-18 | 1.175781 | 1.361000 | 0.90 | 0.80 |
| PG | 2026-09-03 | 1.623671 | 1.400000 | 0.50 | 0.60 |
| CAT | 2026-10-30 | 99.880321 | 29.821000 | 0.50 | 0.60 |
| CAT | 2026-10-16 | 93.623425 | 35.525000 | 0.40 | 0.50 |
| CAT | 2026-10-02 | 39.800887 | 58.609000 | 0.30 | 0.20 |
| CAT | 2026-09-18 | 29.571268 | 11.205000 | 0.60 | 0.60 |
| CAT | 2026-09-03 | 25.967277 | 13.543000 | 0.50 | 0.50 |
| HD | 2026-10-30 | 16.628901 | 18.434000 | 0.50 | 0.50 |
| HD | 2026-10-16 | 23.192142 | 10.401000 | 0.50 | 0.50 |
| HD | 2026-10-02 | 5.678603 | 11.264000 | 0.70 | 0.40 |
| HD | 2026-09-18 | 10.865261 | 9.816000 | 0.40 | 0.40 |
| HD | 2026-09-03 | 7.359098 | 10.572000 | 0.50 | 0.40 |
| NEE | 2026-10-30 | 1.400271 | 2.544000 | 0.70 | 0.80 |
| NEE | 2026-10-16 | 2.291473 | 2.082000 | 0.50 | 0.40 |
| NEE | 2026-10-02 | 1.645370 | 1.263000 | 0.90 | 0.30 |
| NEE | 2026-09-18 | 4.677901 | 3.679000 | 0.50 | 0.40 |
| NEE | 2026-09-03 | 4.678595 | 2.112000 | 0.20 | 0.20 |

## Superseded raw run (15 November 2026)

Local ids 1 through 12 scored the `raw` Massive series on 2026-11-15,
with no seed, from commit `728e5dfc4d48414d7e565ba1528e30375d748ace`.
Its 500-bar series started at 2024-11-15. The script now refuses `raw`,
so that pass is not the official record. Its rows were left in place and
are still `pending`. They should not be approved. Its summary, for
comparison: model MAE lower on 2 of 12 stocks (JPM, NEE), mean model MAE
18.742769 against 9.387642, mean direction 0.5167 against 0.4700. The
conclusion is the same as this run's.

`latest_evaluation` picks the highest id for a symbol, provider, and
adjustment series. The raw and split-adjusted rows are different series,
so an approval of one does not cover the other.

## Model-owner review: PENDING (user)

No named reviewer has accepted this evaluation. All 24 local rows have
`review_status = pending`. Stage 6's exit gate requires that sign-off.
This document does not provide it. On these numbers the evaluation does
not support publishing Kronos forecasts for these stocks.

Until a reviewer sets the latest row for a series to `approved`,
`publish_forecast_result` rejects it with "An unreviewed evaluation cannot
reach a publish path." `forecast_publish_paths` lists that function as the
only writer of a `ForecastResult`. The forecast worker still refuses to
run while `forecast_kronos_enabled` is false, so both gates are closed.
`forecast_results` holds 0 rows after the run.

Steps 4, 5, and 6 stay open: named model-owner review, scheduled
precompute of 10-session forecasts, and publishing reviewed outputs.
Precompute was not scheduled. No forecast was published.

## Migration lineage

`a6c3e840b912` (review-status column) now revises `b7c91a0e4d62`, the head
added by PR 141, so the repository has one alembic head. The local
database was migrated on the earlier lineage, when `a6c3e840b912` revised
`8f3a1c6d9e20`. Its `alembic_version` table therefore holds both
`a6c3e840b912` and `b7c91a0e4d62`. The schema is already complete. That
table needs one manual correction (keep only `a6c3e840b912`) before the
next `alembic upgrade` on this local database. This run did not change it.

## Checks

Full pytest suite in the fresh Python 3.11 virtualenv, with a private
`--basetemp`: 703 passed, 44 skipped. New tests in
`tests/test_forecast_featured_scope.py` cover the 2025-01-09 closure, a
missing session, an empty series, a split-adjusted series that stops
before the raw series, and a model `input_cutoff` past the window cutoff.

Under the system Python 3.14 the suite has 13 environment-only failures:
the Windows Application Control policy blocks the pandas `pandas_parser`
DLL, the shared `pytest-of-sbhav` temp folder is access-denied, and the
3.14 bcrypt build rejects NUL bytes earlier.

The PostgreSQL grant, claim, and admission tests seed a featured symbol
when `AUDIT_DATABASE_URL` is set. They were not executed here. Default CI
skips them when that URL is unset.

The API on port 8000, the frontend on port 5173, and the local Postgres
container were left running.
