# Trade execution markers and open-order price levels — design

Roadmap Phase 3 lines: "Trade execution markers on historical charts" and "Price levels for
open limit orders" (section 3.1); "Plot fills and active orders on charts" (section 3.3). No
new financial computation — this is a chart-overlay feature reusing data two endpoints already
expose. Written before implementation, lighter than a full contract since there is no number to
independently verify (just UI data plumbing and two `lightweight-charts` primitives).

## Scope

Reuse the existing `fetchTrades()` (`GET /trades/`, all of the user's trades, no symbol filter
server-side) and `fetchOrders()` (`GET /orders/`, all orders) — both already used elsewhere in
this frontend. Filter client-side to the symbol currently shown in the daily history chart.
Two new chart overlays, both inside `DailyHistoryCanvas`:

1. **Execution markers**: one marker per trade for the current symbol, placed on that trade's
   session date.
2. **Open-order price lines**: one horizontal price line per currently-`"open"`, `"limit"`
   order for the current symbol (market orders have no `limit_price` and are out of scope —
   "price levels for open **limit** orders" is the roadmap's own exact wording).

## Trade → session-date mapping, and its one explicit limitation

A trade's `executed_at` is a full ISO datetime; the chart's candle `time` values are plain
`YYYY-MM-DD` session-date strings (from `historyCandles`). Map a trade to a candle by taking
the first 10 characters of `executed_at` (its UTC calendar date) and matching it directly
against a candle's `time`. **This is a deliberate simplification, not an exchange-calendar-
aware mapping**: a trade executed very late or very early in UTC could, in principle, land on
a different calendar date than the NYSE trading session it actually belongs to. This feature is
a visual overlay, not a financial calculation, so that edge case is accepted rather than built
around — a trade whose UTC date does not match any loaded candle is simply **skipped** (no
marker drawn, not placed at a wrong/nearby bar, and never a crash).

## Markers and price lines must survive every chart mode, not just candlestick

The chart now has three interchangeable price series (candlestick/line/area, PR #62), only one
`visible` at a time. Rather than relying on an untested assumption about whether hiding a
series also hides its own markers/price lines in this exact library version, **create the same
markers and the same price lines on all three price series** (candlestick, line, and area),
not only on whichever is currently visible. This triples a very small amount of decoration data
(typically a handful of trades/orders per symbol) in exchange for certainty that switching
chart type never silently drops the overlay — a deliberately cheap, safe hedge rather than a
risk worth taking on an unverified library behavior.

- Execution markers: `createSeriesMarkers(series, markers)` (a top-level function import from
  `lightweight-charts`, **not** a method on the series itself — this is the v5 API, replacing
  v4's `series.setMarkers()`), called once per price series, each given the same marker array.
  Marker shape: `position: "belowBar"`, `shape: "arrowUp"`, color `#34d399` (the existing
  buy/up color already used elsewhere in this file) for a `"buy"` trade; `position:
  "aboveBar"`, `shape: "arrowDown"`, color `#fb7185` (the existing sell/down color) for a
  `"sell"` trade. `text`: `` `${side.toUpperCase()} ${quantity}` `` (e.g. `"BUY 5"`).
- Open-order price lines: `series.createPriceLine({...})`, called once per price series per
  open limit order. `price: limit_price`, `color` reusing the same buy/sell color convention,
  `lineStyle: 2` (dashed, the same `LineStyle.Dashed` numeric value Bollinger Bands' own bands
  already use in this file), `lineWidth: 1`, `axisLabelVisible: true`, `title:
  ` `${side.toUpperCase()} limit`` `.

## Lifecycle

Markers are replaced wholesale on every data/symbol change via the markers plugin's own
`.setMarkers()` (no manual diffing needed — call it with the full current array every time,
the same way every other series in this component already calls `.setData()` with the full
array rather than incrementally patching). Price lines do **not** have an equivalent
"set all at once" API — each one is its own object with its own `removePriceLine(line)` call,
so the existing open-order price lines must be explicitly removed (via refs holding the created
`IPriceLine[]` per series) before creating the new set, on every relevant effect re-run, and on
unmount (added to the existing `dispose()` function alongside every other series' cleanup).

## What this feature does not do

Does not add any new backend endpoint — reuses `GET /trades/`/`GET /orders/` exactly as they
already exist, with symbol filtering done client-side (matching how this frontend's existing
`fetchOrders`/`fetchTrades` calls already fetch everything and filter/display client-side
elsewhere). Does not attempt exchange-calendar-aware date mapping for trades (documented
limitation above). Does not add markers/price lines for a different symbol than the one
currently shown. Does not add any new polling — markers/price lines refresh only when this
component's own existing queries refetch (on form submit), not on a timer.
