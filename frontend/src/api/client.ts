import axios, { type InternalAxiosRequestConfig } from "axios";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
let tokenRefreshHandler: ((token: string) => void) | null = null;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const originalRequest = error.config as
        | (InternalAxiosRequestConfig & { _retry?: boolean })
        | undefined;
      const requestUrl = originalRequest?.url ?? "";

      if (
        originalRequest &&
        !originalRequest._retry &&
        !requestUrl.includes("/auth/login") &&
        !requestUrl.includes("/auth/refresh")
      ) {
        originalRequest._retry = true;

        try {
          const refresh = await axios.post<{ access_token: string }>(
            `${API_BASE_URL}/auth/refresh`,
            null,
            { withCredentials: true },
          );
          setAuthToken(refresh.data.access_token);
          tokenRefreshHandler?.(refresh.data.access_token);
          originalRequest.headers.Authorization = `Bearer ${refresh.data.access_token}`;
          return apiClient(originalRequest);
        } catch {
          // Fall through to the existing sign-out behavior.
        }
      }

      clearAuthToken();
      unauthorizedHandler?.();

      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  },
);

export function setAuthToken(token: string) {
  authToken = token;
}

export function clearAuthToken() {
  authToken = null;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export function setTokenRefreshHandler(handler: ((token: string) => void) | null) {
  tokenRefreshHandler = handler;
}
