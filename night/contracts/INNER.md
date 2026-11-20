# Inner pages

Use the routed AppShell and import page UI from `frontend/src/night/inner`. Keep one route component, query tree and set of control values across looks. The shell and instruments read `useLook()`. The approved `/market` owns its separate composition.

## Choose the instrument

| Primitive | Props and use |
| --- | --- |
| `SeriesInstrument` | `{samples, names, format, label, selected, onSelect, reference?, status?}`. Use for comparable observations over ordered sessions. Terrain draws faceted ridges. Dial draws clockwise radial bars and comparison traces. |
| `Sample` | `{label: string, values: readonly (number \| null)[]}`. One visible date or period per slot. Values follow the order of `names`. Use one unit and scale. Series zero supplies the lead reading. |
| `ShareInstrument` | `{parts: {name,value}[], total?, label, format, status?, centrepiece?}`. Nonnegative amounts become thicknesses or angular spans. Supply the whole as `total` when it is known independently, e.g. 100 for account percentages. Otherwise the parts sum to the whole. |
| `ValueGauge` | `{label, value: number \| null, min, max, format, centrepiece?}`. Use a measured interval, e.g. a close within its 52-week low and high. Draws a range ruler or a needle. |
| `RankedRow` | `{name, value: number \| null, max, display, selected?, onSelect?}`. Sort at the source. Use a common positive scale for all marks. The optional callback makes the row a native button. |
| `RestInstrument` | `{label?, status: {kind, title, action?, role?}}`. Keep the unfilled plotting surface for loading, empty, unavailable and error. Give the cause or what supplies observations in one line. Attach the existing retry to errors. |
| `Page` / `Panel` | `Page({title,description?,eyebrow?,actions?,layout?,children})` contains `Main`, `Aside` and `Full` slots. `Panel({title?,subtitle?,actions?,footer?,children})` groups one instrument or related readings. |
| `Stat` | `{label,value,unit?,delta?,tone?,source?,help?}`. Group peer totals in one ruled band. Include the observation date or basis where it matters. Null displays as unavailable. |
| `Table<T>` | `{caption,rows,columns,rowKey,empty?}`. Columns have `key,header,cell,align?`. Right-align values. Use the local scroll container or labeled stacked rows on phones. |
| `Field` / `Button` / `Sheet` | `Field({id,label,hint?,error?,children})` wraps a native control. `Button({variant?,busy?,...buttonProps})`. `Sheet({open,onOpenChange,title,returnFocusRef?,children,footer?})` handles modal focus and dismissal. |

## Data and interaction

- Keep samples in chronological order. Insert nulls for known gaps and preserve the selected date when a look changes. Use the API's coverage and adjustment rules when identifying gaps.
- Keep `selected` as the current index and map `onSelect(index)` back to the page's date. Start at the latest priced observation. The plot accepts pointer and touch inspection. Its native slider supports arrows, Home and End.
- Pass zero as the return reference. For prices the default reference is the first finite lead reading. Dial fills above-reference values and hatches below-reference values. Readouts always retain the original unit.
- Supply stable sample arrays, series names and formatters. Recompute geometry when data or the plot width changes. Keep work off the scroll path.
- Give allocation parts unique names. Preserve absolute weights, cash, unavailable marks, source, range and basis. Never substitute previous observations for missing ones.
- Use one entrance on the main plot. For a share or gauge leading a page, set `centrepiece`. Both OS and stored reduced motion settle immediately. Avoid row entrances, looping charts and scroll handlers that repaint the instrument.

## Frame

- AppShell supplies brand, symbol lookup, signed-in controls, command menu, look switch and mobile dock. Pages supply the title, actions and body. Keep existing gates, route slots, URL parameters, mutation flow and test IDs.
- Use one primary question and one centrepiece per page. At desktop widths give it the widest region. Fill an adjacent column with readings, allocation or context. Put long tables and secondary forms below.
- At 390 px lead with the title, the essential action and the instrument. Keep secondary actions in an accessible disclosure. Use native selects for compact range/type controls and at least 44 px touch targets.
- Work inside `.inner-content`. Use `minmax(0,1fr)`, `min-width:0` and local table overflow. Avoid a second page-width wrapper, nested main landmarks, bespoke header strips and empty fixed-height panels.
- Use the existing look tokens, local fonts and provenance labels. Reserve warm color for the reading or selection. Avoid rainbow sectors, invented figures, animations on ledger rows and images of charts.

## Verification

Run lint, tests and a production build in `frontend`. On Node 26 use `NODE_OPTIONS=--no-experimental-webstorage` for Vitest's jsdom storage. The checked build used a same-origin preview proxy to API 8008.
Inspect muted headless WebKit at 1440 × 900 and 390 × 844 in both looks. Compare matched market captures, document width, first-view instrument geometry and p95 scroll frame intervals. Exercise session inspection, range, chart mode, search, commands, allocation, drill-down, retries and reduced motion.
Model references are Portfolio and AAPL on this branch. Screenshot names follow `{portfolio,aapl,market}-{terrain,dial}-{1440,390}.png`. Measurements live beside them in `fintech-lead/evidence/inner-contract/scroll-and-layout.json`.
At handoff lint, build and 577 frontend tests passed. Both model pages matched the release market's 18 ms p95 in all four profiles. The four settled market comparisons passed. The mobile route walk found zero document overflow across 56 route/look combinations.
