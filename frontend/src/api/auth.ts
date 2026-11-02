import { apiClient } from "./client";
import type {
  LoginCredentials,
  RegisterPayload,
  TokenResponse,
  UserResponse,
} from "../types/schemas";

export async function login(
  credentials: LoginCredentials,
): Promise<TokenResponse> {
  const formData = new URLSearchParams();
  formData.set("username", credentials.username);
  formData.set("password", credentials.password);

  const response = await apiClient.post<TokenResponse>("/auth/login", formData, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data;
}

export async function register(payload: RegisterPayload): Promise<UserResponse> {
  const response = await apiClient.post<UserResponse>("/auth/register", payload);
  return response.data;
}

export async function fetchMe(): Promise<UserResponse> {
  const response = await apiClient.get<UserResponse>("/auth/me");
  return response.data;
}

export async function refreshSession(): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>("/auth/refresh");
  return response.data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}
