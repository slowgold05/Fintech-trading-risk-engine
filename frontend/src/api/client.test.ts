import { AxiosError } from "axios";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient, setUnauthorizedHandler } from "./client";

const originalAdapter = apiClient.defaults.adapter;

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

it("clears an expired session without navigating away from the public dashboard", async () => {
  const assign = vi.fn();
  const onUnauthorized = vi.fn();
  vi.stubGlobal("window", { location: { pathname: "/", assign } });
  setUnauthorizedHandler(onUnauthorized);
  apiClient.defaults.adapter = async (config) => {
    throw new AxiosError("No session", "ERR_BAD_REQUEST", config, null, {
      status: 401, statusText: "Unauthorized", data: {}, headers: {}, config,
    });
  };

  await expect(apiClient.post("/auth/refresh")).rejects.toThrow("No session");

  expect(onUnauthorized).toHaveBeenCalledOnce();
  expect(assign).not.toHaveBeenCalled();
});
