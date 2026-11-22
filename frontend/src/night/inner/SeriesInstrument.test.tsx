import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LookContext, readPreferences, type Look } from "../looks/preferences";
import { SeriesInstrument } from "./SeriesInstrument";
import { traces, type Sample } from "./geometry";

afterEach(cleanup);
const samples: Sample[] = [
  { label: "First", values: [0] },
  { label: "Missing", values: [null] },
  { label: "Last", values: [2] },
];
describe("session instruments", () => {
  it("breaks the mesh and comparison trace at missing samples", () => {
    expect(traces(samples, 0, (i, v) => [i, v])).toEqual([[[0, 0]], [[2, 2]]]);
  });
  it.each<Look>(["terrain", "dial"])("keeps the unpriced date inspectable in %s", (look) => {
    const onSelect = vi.fn();
    render(
      <LookContext.Provider value={{ prefs: { ...readPreferences(), look }, update: () => {} }}>
        <SeriesInstrument
          samples={samples}
          names={["Return"]}
          selected={1}
          onSelect={onSelect}
          reference={0}
          format={String}
          label="Inspect session"
        />
      </LookContext.Provider>
    );
    const slider = screen.getByRole("slider", { name: "Inspect session" });
    expect(slider).toHaveAttribute("aria-valuetext", "Missing");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    fireEvent.change(slider, { target: { value: "2" } });
    expect(onSelect).toHaveBeenCalledWith(2);
  });
  it("keeps the empty instrument at rest with its explanation", () => {
    render(
      <SeriesInstrument
        samples={[]}
        names={["Close"]}
        selected={0}
        onSelect={() => {}}
        format={String}
        label="Inspect close"
      />
    );
    expect(screen.getByRole("img", { name: "Inspect close" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Recorded observations fill Close.");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
