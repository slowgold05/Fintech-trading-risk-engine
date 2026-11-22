import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

export function renderMarket(element: ReactElement, path = "/market") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}>
    {element}
  </QueryClientProvider></MemoryRouter>);
}
