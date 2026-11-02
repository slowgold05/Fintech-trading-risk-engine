import { type FormEvent, useState } from "react";
import { Check, Lock, User } from "@phosphor-icons/react";
import { isAxiosError } from "axios";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, register } from "../api/auth";
import { useAuth } from "../context/useAuth";

const features = [
  "Real-time portfolio valuation and P&L",
  "Risk-aware trade execution engine",
  "FIFO cost-basis and exposure analytics",
  "Live market pulse and sector heatmap",
];

type AuthMode = "login" | "register";

function passwordStrength(password: string, username: string) {
  const categories = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  const localPart = username.split("@", 1)[0]?.toLowerCase() ?? "";
  let score = 0;

  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (categories >= 2) score += 1;
  if (categories >= 3) score += 1;
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) score -= 1;
  if (new Set(password).size <= 2) score -= 1;

  const normalized = Math.max(0, Math.min(4, score));
  const labels = ["Too weak", "Weak", "Fair", "Good", "Strong"];
  return {
    score: normalized,
    label: labels[normalized],
    passesMinimum: password.length >= 8 && categories >= 2 && new Set(password).size > 2,
  };
}

export function Login() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? "/dashboard";

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === "register") {
        await register({ email: username, password });
      }
      const tokenResponse = await login({ username, password });
      signIn(tokenResponse.access_token);
      navigate(from, { replace: true });
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 401) {
        setError("Invalid username or password.");
      } else if (isAxiosError(err) && err.response?.status === 400) {
        setError("That email is already registered.");
      } else if (isAxiosError(err) && err.response?.status === 422) {
        setError("Use a stronger password before creating an account.");
      } else {
        setError("Unable to continue. Check the API connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const strength = passwordStrength(password, username);
  const isRegistering = mode === "register";

  return (
    <div className="flex min-h-[100dvh] bg-[#020617]">
      {/* Left panel — visible on md+ */}
      <div className="relative hidden md:flex md:w-[420px] lg:w-[480px] shrink-0 flex-col justify-between overflow-hidden border-r border-slate-800/70 bg-[#040b14] px-10 py-12">
        {/* Background glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at -10% 110%, rgb(16 185 129 / 0.12), transparent 60%), radial-gradient(ellipse 60% 40% at 110% -10%, rgb(30 58 138 / 0.1), transparent 60%)",
          }}
        />

        {/* Logo */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgb(52_211_153_/_0.3),0_0_24px_-6px_rgb(52_211_153_/_0.4)]">
              <span className="font-mono text-sm font-bold text-emerald-400">GY</span>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-400">
                getrichyesterday
              </div>
              <div className="text-[10px] text-slate-500">v2.0 · Institutional</div>
            </div>
          </div>

          <h2 className="mt-12 text-3xl font-semibold leading-tight tracking-tight text-slate-50">
            Institutional-grade<br />
            <span className="text-emerald-400">trading intelligence</span>
          </h2>
          <p className="mt-4 text-sm leading-7 text-slate-400">
            A unified platform for real-time portfolio management, risk-aware
            execution, and market intelligence.
          </p>

          <ul className="mt-8 space-y-3">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-3 text-sm text-slate-300">
                <Check className="size-4 shrink-0 text-emerald-400" weight="bold" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom status */}
        <div className="relative">
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-3">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs font-medium text-slate-400">
              All systems operational
            </span>
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-3 md:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgb(52_211_153_/_0.25)]">
              <span className="font-mono text-xs font-bold text-emerald-400">GY</span>
            </div>
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-400">
              getrichyesterday
            </span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
              {isRegistering ? "Create account" : "Welcome back"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {isRegistering
                ? "Start with a secured paper-trading account."
                : "Sign in to access your trading and risk dashboard."}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_4px_32px_-8px_rgba(0,0,0,0.6)]">
            <form className="space-y-5" onSubmit={handleSubmit}>
              {/* Email */}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Email
                </span>
                <div className="relative mt-2">
                  <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                    <User className="size-4 text-slate-400" weight="light" />
                  </div>
                  <input
                    aria-label="Email"
                    autoComplete="username"
                    className="min-h-11 w-full rounded-xl border border-slate-700/90 bg-slate-900/80 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none transition duration-200 placeholder:text-slate-500 hover:border-slate-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSubmitting}
                    name="username"
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="you@example.com"
                    required
                    type="email"
                    value={username}
                  />
                </div>
              </label>

              {/* Password */}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Password
                </span>
                <div className="relative mt-2">
                  <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                    <Lock className="size-4 text-slate-400" weight="light" />
                  </div>
                  <input
                    aria-label="Password"
                    autoComplete="current-password"
                    className="min-h-11 w-full rounded-xl border border-slate-700/90 bg-slate-900/80 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none transition duration-200 placeholder:text-slate-500 hover:border-slate-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSubmitting}
                    name="password"
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    type="password"
                    value={password}
                  />
                </div>
              </label>

              {isRegistering && (
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Password strength
                    </span>
                    <span className="font-mono text-slate-300">{strength.label}</span>
                  </div>
                  <div
                    aria-label={`Password strength: ${strength.label}`}
                    aria-valuemax={4}
                    aria-valuemin={0}
                    aria-valuenow={strength.score}
                    className="mt-2 grid grid-cols-4 gap-1.5"
                    role="meter"
                  >
                    {[1, 2, 3, 4].map((step) => (
                      <span
                        key={step}
                        className={[
                          "h-1.5 rounded-full",
                          step <= strength.score ? "bg-emerald-400" : "bg-slate-800",
                        ].join(" ")}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    Use at least 8 characters and mix letters, numbers, or symbols.
                  </p>
                </div>
              )}

              {error && (
                <p
                  className="rounded-xl border border-rose-500/30 bg-rose-950/50 px-3 py-2.5 text-sm text-rose-200"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <button
                aria-label={isRegistering ? "Create account" : "Sign in"}
                className="primary-action mt-2"
                disabled={isSubmitting || (isRegistering && !strength.passesMinimum)}
                type="submit"
              >
                {isSubmitting
                  ? isRegistering
                    ? "Creating account..."
                    : "Signing in..."
                  : isRegistering
                    ? "Create account"
                    : "Continue"}
              </button>
            </form>
            <button
              className="mt-4 w-full text-center text-xs font-medium text-slate-400 transition hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
              onClick={() => {
                setError(null);
                setMode((current) => (current === "login" ? "register" : "login"));
              }}
              type="button"
            >
              {isRegistering
                ? "Already have an account? Sign in"
                : "Need an account? Create one"}
            </button>
          </div>

          <p className="mt-6 text-center text-[11px] text-slate-500">
            getrichyesterday &middot; Secure session
          </p>
        </div>
      </div>
    </div>
  );
}
