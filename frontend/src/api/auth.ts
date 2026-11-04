import { apiClient } from "./client";
import type {
  LoginCredentials,
  RegisterPayload,
  TokenResponse,
  UserResponse,
} from "../types/schemas";

export type LoginResult =
  | { mfa_required: false; access_token: string; token_type: string }
  | { mfa_required: true; challenge_id: number; reasons: string[] };

export async function login(
  credentials: LoginCredentials,
): Promise<LoginResult> {
  const formData = new URLSearchParams();
  formData.set("username", credentials.username);
  formData.set("password", credentials.password);

  const response = await apiClient.post<LoginResult>("/auth/login", formData, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data;
}

export async function completeLoginMfa(payload: { challenge_id: number; code: string }): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>("/auth/login/mfa", payload);
  return response.data;
}

export async function enrollMfa(payload: { email: string; password: string }): Promise<{ secret: string; otpauth_uri: string }> {
  const response = await apiClient.post<{ secret: string; otpauth_uri: string }>("/auth/mfa/enroll", payload);
  return response.data;
}

export async function confirmMfaEnrollment(payload: { email: string; password: string; code: string }): Promise<void> {
  await apiClient.post("/auth/mfa/enroll/confirm", payload);
}

export async function register(payload: RegisterPayload): Promise<UserResponse> {
  const response = await apiClient.post<UserResponse>("/auth/register", payload);
  return response.data;
}

export async function fetchMe(): Promise<UserResponse> {
  const response = await apiClient.get<UserResponse>("/auth/me");
  return response.data;
}

export async function setLegalName(fullName: string): Promise<{ full_name: string }> {
  const response = await apiClient.put<{ full_name: string }>("/auth/name", { full_name: fullName });
  return response.data;
}

export async function refreshSession(): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>("/auth/refresh");
  return response.data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}
