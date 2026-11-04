import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthContext } from "../context/authState";
import { Login } from "./Login";

const authApi = vi.hoisted(() => ({
  login: vi.fn(),
  completeLoginMfa: vi.fn(),
  enrollMfa: vi.fn(),
  confirmMfaEnrollment: vi.fn(),
  register: vi.fn(),
}));

vi.mock("../api/auth", () => authApi);

function renderLogin() {
  const signIn = vi.fn();
  render(
    <AuthContext.Provider
      value={{
        token: null,
        isAuthenticated: false,
        isInitializing: false,
        signIn,
        signOut: () => undefined,
      }}
    >
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return signIn;
}

describe("Login", () => {
  afterEach(() => cleanup());

  it("signs in when the password response includes an access token", async () => {
    authApi.login.mockResolvedValueOnce({
      mfa_required: false,
      access_token: "token-1",
      token_type: "bearer",
    });
    const signIn = renderLogin();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "trader@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith("token-1"));
    expect(authApi.completeLoginMfa).not.toHaveBeenCalled();
  });

  it("asks for a code when login requires step-up", async () => {
    authApi.login.mockResolvedValueOnce({
      mfa_required: true,
      challenge_id: 7,
      reasons: ["new_device"],
    });
    authApi.completeLoginMfa.mockResolvedValueOnce({
      access_token: "token-2",
      token_type: "bearer",
    });
    const signIn = renderLogin();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "trader@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    fireEvent.change(await screen.findByLabelText("Sign-in code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() => expect(authApi.completeLoginMfa).toHaveBeenCalledWith({
      challenge_id: 7,
      code: "123456",
    }));
    expect(signIn).toHaveBeenCalledWith("token-2");
  });
});
