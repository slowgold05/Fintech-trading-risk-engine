"""Walk-forward evaluation of a caller-supplied forecaster.

This module is the methodology only. It does not import torch, Kronos, or any
vendored model. A caller passes ``forecaster(bars, horizon) -> list[float]``.
The offline script is what adapts a real model to that convention.
"""


def _mean_absolute_error(actual: list[float], predicted: list[float]) -> float:
    return sum(abs(a - p) for a, p in zip(actual, predicted)) / len(actual)


def _directional_accuracy(reference: float, actual: list[float], predicted: list[float]) -> float:
    """Hit rate of each day's direction against the real previous close.

    ``prev`` starts at the last close the forecaster was allowed to see, then
    steps through the actual closes. It never steps through the predictions, so
    one wrong call cannot flip every later day.
    """
    hits = 0
    prev = reference
    for a, p in zip(actual, predicted):
        actual_dir = (a > prev) - (a < prev)
        pred_dir = (p > prev) - (p < prev)
        if actual_dir == pred_dir:
            hits += 1
        prev = a
    return hits / len(actual)


def _baseline_last_close(reference: float, horizon: int) -> list[float]:
    return [reference] * horizon


def evaluate_walk_forward_window(
    history_bars: list[dict], cutoff_index: int, horizon: int, forecaster,
) -> dict:
    observed = history_bars[:cutoff_index]
    actual_bars = history_bars[cutoff_index:cutoff_index + horizon]
    actual = [bar["close"] for bar in actual_bars]
    reference = observed[-1]["close"]
    predicted = forecaster(observed, horizon)
    baseline = _baseline_last_close(reference, horizon)
    return {
        "cutoff_date": observed[-1]["session_date"],
        "model_mae": _mean_absolute_error(actual, predicted),
        "model_directional_accuracy": _directional_accuracy(reference, actual, predicted),
        "baseline_mae": _mean_absolute_error(actual, baseline),
        "baseline_directional_accuracy": _directional_accuracy(reference, actual, baseline),
    }


def run_walk_forward_evaluation(
    history_bars: list[dict], *, horizon: int, window_count: int, forecaster,
) -> dict:
    """Score ``window_count`` non-overlapping windows, newest first.

    The first cutoff leaves the last ``horizon`` bars as the actual future.
    Each next cutoff moves back by ``horizon`` bars, so no two windows share
    an actual-future bar. Fewer windows than requested is an error.
    """
    required = horizon * window_count
    if len(history_bars) <= required:
        raise ValueError(
            f"insufficient history: {len(history_bars)} bars, need more than "
            f"{required} ({window_count} non-overlapping windows of horizon {horizon})."
        )
    windows = []
    cutoff_index = len(history_bars) - horizon
    for _ in range(window_count):
        windows.append(evaluate_walk_forward_window(history_bars, cutoff_index, horizon, forecaster))
        cutoff_index -= horizon

    def _avg(key):
        return sum(w[key] for w in windows) / len(windows)

    return {
        "windows": windows,
        "window_count": window_count,
        "horizon": horizon,
        "model_mae": _avg("model_mae"),
        "model_directional_accuracy": _avg("model_directional_accuracy"),
        "baseline_mae": _avg("baseline_mae"),
        "baseline_directional_accuracy": _avg("baseline_directional_accuracy"),
    }
