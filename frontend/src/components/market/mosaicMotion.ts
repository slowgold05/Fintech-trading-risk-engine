import { flushSync } from "react-dom";

type Tile = { node: HTMLElement; key: string; sector: string; rect: DOMRect };

function measure(region: HTMLElement) {
  return Array.from(region.querySelectorAll<HTMLElement>("[data-tile]"), (node) => ({
    node,
    key: node.dataset.tile!,
    sector: node.dataset.sector!,
    rect: node.getBoundingClientRect(),
  }));
}
function counterpart(tile: Tile, others: Tile[]) {
  return (
    others.find((t) => t.key === tile.key) ??
    others.find((t) => t.sector === tile.sector && t.key.startsWith("fund:")) ??
    others.find((t) => t.sector === tile.sector)
  );
}
function transform(from: DOMRect, to: DOMRect) {
  return `translate(${to.x - from.x}px,${to.y - from.y}px) scale(${to.width / (from.width || 1)},${to.height / (from.height || 1)})`;
}

// Geometry is read only on commit. WAAPI owns all intermediate positions,
// including the presentation rectangles captured by a second, rapid switch.
export function moveTiles(region: HTMLElement | null, update: () => void) {
  if (!region?.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const old = measure(region);
  region.querySelectorAll(".departing-tiles").forEach((node) => node.remove());
  for (const tile of old) tile.node.getAnimations().forEach((a) => a.cancel());
  flushSync(update);
  const next = measure(region);
  const origin = region.getBoundingClientRect();
  const timing = { duration: 370, easing: "cubic-bezier(.22,.68,.12,1)" };
  for (const tile of next) {
    const match = counterpart(tile, old);
    if (!match) continue;
    tile.node.animate(
      [
        { transform: transform(tile.rect, match.rect), opacity: tile.key === match.key ? 1 : 0.2 },
        { transform: "none", opacity: 1 },
      ],
      timing,
    );
  }
  const layer = document.createElement("div");
  layer.className = "departing-tiles";
  layer.inert = true;
  layer.setAttribute("aria-hidden", "true");
  for (const tile of old) {
    if (next.some((t) => t.key === tile.key)) continue;
    const target = counterpart(tile, next);
    if (!target) continue;
    const copy = tile.node.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-tile");
    Object.assign(copy.style, {
      position: "absolute",
      margin: "0",
      left: tile.rect.left - origin.left + region.scrollLeft + "px",
      top: tile.rect.top - origin.top + region.scrollTop + "px",
      width: tile.rect.width + "px",
      height: tile.rect.height + "px",
    });
    layer.append(copy);
    copy.animate(
      [
        { transform: "none", opacity: 0.85 },
        { transform: transform(tile.rect, target.rect), opacity: 0 },
      ],
      timing,
    );
  }
  if (layer.childElementCount) {
    region.append(layer);
    window.setTimeout(() => layer.remove(), timing.duration + 40);
  }
}
