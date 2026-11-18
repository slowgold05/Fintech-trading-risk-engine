import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AxiosError } from "axios";

import { AuthContext } from "../context/authState";
import { Login } from "./Login";

const authApi = vi.hoisted(() => ({
  login: vi.fn(),
  completeLoginMfa: vi.fn(),
  enrollMfa: vi.fn(),
  confirmMfaEnrollment: vi.fn(),
  register: vi.fn(),
  startDemo: vi.fn(),
}));

vi.mock("../api/auth", () => authApi);

const safeFrom = { pathname: "/trades", search: "?symbol=AT%26T" };

function LocationProbe() {
  const location = useLocation();
  return <h1>{`Landed ${location.pathname}${location.search}`}</h1>;
}

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

function renderReturn(state: unknown, authenticated = false) {
  const signIn = vi.fn();
  render(
    <AuthContext.Provider
      value={{
        token: authenticated ? "token-ready" : null,
        isAuthenticated: authenticated,
        isInitializing: false,
        signIn,
        signOut: () => undefined,
      }}
    >
      <MemoryRouter initialEntries={[{ pathname: "/login", state }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return signIn;
}

function submitPassword() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "trader@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

const unsafeReturns = [
  ["missing state", null],
  ["non-object from", { from: "https://evil.example/trades" }],
  ["external pathname", { from: { pathname: "https://evil.example/trades", search: "?symbol=AAPL" } }],
  ["protocol-relative pathname", { from: { pathname: "//evil.example/trades", search: "" } }],
  ["backslash pathname", { from: { pathname: "/\\evil", search: "" } }],
  ["control in pathname", { from: { pathname: "/trades\u0001", search: "" } }],
  ["query inside pathname", { from: { pathname: "/trades?symbol=AAPL", search: "" } }],
  ["hash inside pathname", { from: { pathname: "/trades#session", search: "" } }],
  ["relative pathname", { from: { pathname: "trades", search: "?symbol=AAPL" } }],
  ["search missing the question mark", { from: { pathname: "/trades", search: "symbol=AAPL" } }],
  ["control in search", { from: { pathname: "/trades", search: "?symbol=AAPL\n" } }],
  ["non-string search", { from: { pathname: "/trades", search: ["?symbol=AAPL"] } }],
] as const;

describe("Login", () => {
  afterEach(() => {
    cleanup();
    authApi.login.mockReset();
    authApi.completeLoginMfa.mockReset();
    authApi.enrollMfa.mockReset();
    authApi.confirmMfaEnrollment.mockReset();
    authApi.register.mockReset();
    authApi.startDemo.mockReset();
  });

  it("starts a demo without credentials and opens the dashboard", async () => {
    authApi.startDemo.mockResolvedValueOnce({ access_token: "demo-session" });
    const signIn = renderReturn({ from: safeFrom });
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(await screen.findByRole("heading", { name: "Landed /dashboard" })).toBeInTheDocument();
    expect(authApi.startDemo).toHaveBeenCalledTimes(1);
    expect(authApi.login).not.toHaveBeenCalled();
    expect(authApi.register).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith("demo-session");
  });

  it("shows a demo signup error and allows another attempt", async () => {
    authApi.startDemo.mockRejectedValueOnce(new AxiosError("Busy", undefined, undefined, undefined, {
      status: 429,
      data: { detail: "Demo signup is busy. Try again shortly." },
    } as AxiosError["response"]));
    const signIn = renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Demo signup is busy");
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeEnabled();
    expect(signIn).not.toHaveBeenCalled();
  });

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

  it("returns to the same-app path and search after a password sign-in", async () => {
    authApi.login.mockResolvedValueOnce({
      mfa_required: false,
      access_token: "token-3",
      token_type: "bearer",
    });
    const signIn = renderReturn({ from: safeFrom });
    submitPassword();
    expect(await screen.findByRole("heading", { name: "Landed /trades?symbol=AT%26T" })).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledWith("token-3");
  });

  it("keeps the requested trade query when authenticator sign-in completes", async () => {
    authApi.login.mockResolvedValueOnce({
      mfa_required: true,
      challenge_id: 9,
      reasons: ["new_device"],
    });
    authApi.completeLoginMfa.mockResolvedValueOnce({
      access_token: "token-4",
      token_type: "bearer",
    });
    renderReturn({ from: { pathname: "/trades", search: "?symbol=BRK.B" } });
    submitPassword();
    fireEvent.change(await screen.findByLabelText("Sign-in code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByRole("heading", { name: "Landed /trades?symbol=BRK.B" })).toBeInTheDocument();
  });

  it.each([
    ["absent search", { pathname: "/portfolio" }],
    ["empty search", { pathname: "/portfolio", search: "" }],
  ])("accepts a same-app return with %s", async (_label, from) => {
    authApi.login.mockResolvedValueOnce({
      mfa_required: false,
      access_token: "token-5",
      token_type: "bearer",
    });
    renderReturn({ from });
    submitPassword();
    expect(await screen.findByRole("heading", { name: "Landed /portfolio" })).toBeInTheDocument();
  });

  it("sends an already authenticated session to the safe return", () => {
    renderReturn({ from: safeFrom }, true);
    expect(screen.getByRole("heading", { name: "Landed /trades?symbol=AT%26T" })).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it.each(unsafeReturns)("falls back to the dashboard for %s", async (_label, state) => {
    authApi.login.mockResolvedValueOnce({
      mfa_required: false,
      access_token: "token-6",
      token_type: "bearer",
    });
    renderReturn(state);
    submitPassword();
    expect(await screen.findByRole("heading", { name: "Landed /dashboard" })).toBeInTheDocument();
  });

  it.each(unsafeReturns)("ignores %s when the session is already authenticated", (_label, state) => {
    renderReturn(state, true);
    expect(screen.getByRole("heading", { name: "Landed /dashboard" })).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });
});

describe("registration and authenticator setup", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

  it("associates server validation messages with the failed input", async () => {
    authApi.register.mockRejectedValueOnce(new AxiosError("Invalid", undefined, undefined, undefined, {
      status:422, data:{detail:[{loc:["body","password"],msg:"Value error, Password is too common"}]},
    } as AxiosError["response"]));
    renderLogin();
    fireEvent.click(screen.getByRole("button",{name:/Need an account/}));
    fireEvent.change(screen.getByLabelText("Email"),{target:{value:"tester@example.com"}});
    fireEvent.change(screen.getByLabelText("Password"),{target:{value:"qwerty123"}});
    fireEvent.click(screen.getByTestId("auth-submit"));
    expect(await screen.findByText("Password is too common")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid","true");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(/Password is too common/);
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it("enrolls an authenticator and returns to the password form", async () => {
    authApi.enrollMfa.mockResolvedValueOnce({secret:"fixture"});
    authApi.confirmMfaEnrollment.mockResolvedValueOnce(undefined);
    renderLogin();
    fireEvent.click(screen.getByRole("button",{name:"Set up an authenticator"}));
    fireEvent.change(screen.getByLabelText("Email"),{target:{value:"tester@example.com"}});
    fireEvent.change(screen.getByLabelText("Password"),{target:{value:"password123"}});
    fireEvent.click(screen.getByTestId("auth-submit"));
    fireEvent.change(await screen.findByLabelText("Enrollment code"),{target:{value:"123456"}});
    fireEvent.click(screen.getByTestId("auth-submit"));
    expect(await screen.findByText("Authenticator saved. Sign in to continue.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Authenticator secret")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Sign in"})).toBeEnabled();
  });

  it("keeps regular sign-in and registration available with demo disabled", () => {
    vi.stubEnv("VITE_DEMO_ENABLED","false");
    renderLogin();
    expect(screen.queryByTestId("demo-start")).not.toBeInTheDocument();
    expect(screen.getByTestId("auth-submit")).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:/Need an account/}));
    expect(screen.getByRole("heading",{name:"Create account"})).toBeInTheDocument();
  });
});
