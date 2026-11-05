# Architecture diagram sources

The Sentinel Markets diagram was built with [stack-diagram](https://github.com/caru-ini/stack-diagram), pinned to commit [`1ed53e3e9525364ae5d82e0430f2bb3f7ef4c838`](https://github.com/caru-ini/stack-diagram/tree/1ed53e3e9525364ae5d82e0430f2bb3f7ef4c838).

[The self-contained HTML](sentinel-markets-stack.html) is the diagram's source of truth. The [light PNG](sentinel-markets-stack.png) and [dark PNG](sentinel-markets-stack-dark.png) are Chromium renders of its `.canvas` element at scale 2. The HTML embeds its SVG icons and fonts and works offline. Application dependencies are unchanged.

The icon sources used are [svgl](https://svgl.app/), [Lucide](https://lucide.dev/), and [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/). Brand marks remain the trademarks of their respective owners. AWS icons are embedded within the complete diagram; the standalone icon package is not redistributed here. The [Lucide license notice](licenses/Lucide.txt) includes its ISC terms and the MIT terms for icons derived from Feather.

The template is covered by the included [stack-diagram MIT license](licenses/stack-diagram-MIT.txt). Embedded Geist and JetBrains Mono fonts are covered separately by their included SIL Open Font License notices: [Geist](licenses/OFL-Geist.txt) and [JetBrains Mono](licenses/OFL-JetBrainsMono.txt).

To regenerate the PNGs, check out the pinned skill and install its Playwright/Chromium rendering dependency in an isolated environment, then run from the repository root:

```text
python <skill>/scripts/render_png.py docs/diagrams/sentinel-markets-stack.html docs/diagrams/sentinel-markets-stack.png --selector .canvas --scale 2
```

Both themes must be visually checked after changing labels, nodes, or edges. The diagram describes the deployed request, control, and operator release paths; it does not depict a customer-managed VPC or subnet layout.
