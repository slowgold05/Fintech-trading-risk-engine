# Forecast models listing contract

Fourth unit of roadmap Phase 6 (Experimental Forecast Lab) — `GET /forecasts/models`,
the one remaining trivial piece of the named API surface (section 6.4) not yet
built. A small, read-only route: this app configures exactly one forecast model
(Kronos, via settings), not a dynamic catalog, so the response describes that one
configured model and its current operational state — enabled or not, its bounds,
its pinned source commit and license. No new model, no migration, no job.

## New route, added to `app/routers/forecasts.py` (alongside the existing routes,
all untouched)

```python
@router.get("/models")
def list_forecast_models(current_user: User = Depends(get_current_user)):
    return {
        "models": [
            {
                "id": "kronos",
                "model_name": settings.forecast_kronos_model_name,
                "tokenizer_name": settings.forecast_kronos_tokenizer_name,
                "enabled": settings.forecast_kronos_enabled,
                "max_lookback": settings.forecast_kronos_max_lookback,
                "max_horizon": settings.forecast_kronos_max_horizon,
                "max_sample_count": settings.forecast_kronos_max_sample_count,
                "source_commit": "67b630e67f6a18c9e9be918d9b4337c960db1e9a",
                "license": "MIT",
            }
        ]
    }
```

The source commit string is the exact same pin PR #76 vendored
(`app/vendor/kronos/NOTICE.md`) and PR #76's own validation script already records
(`app/scripts/validate_forecast_kronos.py`'s `SOURCE_COMMIT` constant) — reuse that
same literal value, do not invent a second copy that could drift from the vendored
source if it's ever re-pinned.

Requires authentication (`Depends(get_current_user)`), same as every other route in
this app, even though the response carries no user-specific data — consistency
with the existing baseline, not because this data is sensitive.

**Route-ordering note**: add this after the existing `/jobs`, `""` (list results),
and `/{forecast_id}` routes are already registered. `/models` is a literal path
segment, so it is matched before the parameterized `/{forecast_id}` route
regardless of registration order in this specific case (FastAPI prefers literal
path matches over parameterized ones) — but add it in the same file-order
convention as every other route addition this session has used regardless, for
readability.

## New schema: `app/schemas/forecast_model.py`

```python
class ForecastModelOut(BaseModel):
    id: str
    model_name: str
    tokenizer_name: str
    enabled: bool
    max_lookback: int
    max_horizon: int
    max_sample_count: int
    source_commit: str
    license: str

class ForecastModelCollection(BaseModel):
    models: list[ForecastModelOut]
```

(This unit's route can return the plain dict shape above without explicitly
declaring `response_model=`, consistent with every other route in this app — the
schema exists for documentation/type clarity and potential future reuse, same as
every other `*Collection`/`*Out` schema in this codebase.)

## What this unit does not do

No `GET /forecasts/evaluations` — that route is meaningless until roadmap section
6.3's walk-forward evaluation methodology actually exists and produces something to
list; it is deferred to be built alongside that unit, not stubbed empty here. No
chart UI. No frontend. Does not touch any existing route, job, or worker.
