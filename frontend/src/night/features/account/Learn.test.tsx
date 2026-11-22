import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { Learn } from "./Learn";

afterEach(cleanup);

it("opens a linked topic and keeps all five interpretations reachable", async () => {
  render(<MemoryRouter initialEntries={["/learn#concentration"]}><Learn/></MemoryRouter>);
  const concentration = screen.getByRole("link", {name:"Position concentration"});
  expect(concentration).toHaveAttribute("aria-current","location");
  expect(screen.getByTestId("learn-concentration")).toHaveAttribute("open");
  await userEvent.click(screen.getByRole("link", {name:"Order previews"}));
  expect(screen.getByTestId("learn-preview")).toHaveAttribute("open");
  expect(screen.getByTestId("learn-concentration")).not.toHaveAttribute("open");
  expect(screen.getAllByText("Interpret this metric")).toHaveLength(5);
});
