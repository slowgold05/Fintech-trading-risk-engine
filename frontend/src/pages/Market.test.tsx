import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Market } from "./Market";

vi.mock("./TerrainMarket", () => ({ TerrainMarket: () => <h1>Terrain market</h1> }));
vi.mock("./DialMarket", () => ({ DialMarket: () => <h1>Dial market</h1> }));

afterEach(() => {
  cleanup();
  localStorage.removeItem("sentinel.look");
});

it("defaults to Terrain and remembers the switch when returning to the market", async () => {
  const firstVisit = render(<Market />);
  await screen.findByRole("heading", { name: "Terrain market" });
  expect(document.documentElement).toHaveAttribute("data-look", "terrain");

  fireEvent.click(screen.getByRole("button", { name: "Switch to Dial" }));
  await screen.findByRole("heading", { name: "Dial market" });
  expect(document.documentElement).toHaveAttribute("data-look", "dial");

  firstVisit.unmount();
  expect(document.documentElement).not.toHaveAttribute("data-look");
  render(<Market />);
  expect(await screen.findByRole("heading", { name: "Dial market" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Switch to Terrain" }));
  expect(await screen.findByRole("heading", { name: "Terrain market" })).toBeVisible();
});
