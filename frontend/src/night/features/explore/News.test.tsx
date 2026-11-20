import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { renderMarket } from "./testSupport";
import { News } from "./News";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("renders an attributed stale link, omits unusable URLs and uses explicit tags", async () => {
  const item = {id:"1",title:"Issuer files results",publisher:"Publisher",url:"https://example.org/story",published_at:"2026-11-17T16:00:00Z",symbols:[]};
  const read = vi.spyOn(apiClient,"get").mockResolvedValue({data:{coverage:"stale",as_of:item.published_at,items:[item,{...item,id:"2",url:"javascript:void(0)",title:"No source"}]}});
  renderMarket(<News />);
  expect(await screen.findByRole("link",{name:item.title})).toHaveAttribute("href", item.url);
  expect(screen.queryByText("No source")).toBeNull();
  expect(screen.getByText(/Cache coverage · stale/)).toBeVisible();
  read.mockResolvedValue({data:{coverage:"missing",as_of:null,items:[]}});
  fireEvent.change(screen.getByLabelText("Symbol"),{target:{value:" aapl "}});
  fireEvent.click(screen.getByRole("button",{name:"Filter headlines"}));
  expect(await screen.findByText("No sourced headlines tagged AAPL")).toBeVisible();
});

it("changes the featured publisher and keeps every sourced article in the edition", async () => {
  const base = { published_at:"2026-11-17T16:00:00Z", symbols:[] };
  const items = [
    { ...base, id:"1", publisher:"Wire", title:"Wire story", url:"https://example.org/wire" },
    { ...base, id:"2", publisher:"Journal", title:"Journal story", url:"https://example.org/journal" },
  ];
  vi.spyOn(apiClient,"get").mockResolvedValue({data:{coverage:"available",as_of:base.published_at,items}});
  renderMarket(<News/>);
  fireEvent.click(await screen.findByRole("button",{name:/^Journal/}));
  expect(screen.getByRole("img",{name:"Journal, 1 of 2 sourced headlines"})).toBeVisible();
  expect(screen.getByRole("link",{name:"Journal story"}).closest("section")).toHaveTextContent("Latest from this publisher");
  expect(screen.getByRole("link",{name:"Wire story"})).toHaveAttribute("href",items[0].url);
});
