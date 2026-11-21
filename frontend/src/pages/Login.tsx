import { type FormEvent, useState } from "react";
import { Button, Field, Page, Panel } from "../night/inner";
import { authFailure, type AuthFailure } from "./LoginErrors";
import { LoginInstrument } from "./LoginInstrument";
import "./Login.css";

import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { completeLoginMfa, confirmMfaEnrollment, enrollMfa, login, register, startDemo } from "../api/auth";
import { destinations, features, safeReturnTo } from "../night/registry";
import { useAuth } from "../context/useAuth";

type Stage = "password" | "code" | "enroll";

function hasControlOrBackslash(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127 || value[index] === "\\") return true;
  }
  return false;
}

function safeAppFrom(state: unknown): string {
  if (typeof state !== "object" || state === null) return "/dashboard";
  const from = "from" in state ? state.from : undefined;
  if (typeof from !== "object" || from === null) return "/dashboard";
  const pathname = "pathname" in from ? from.pathname : undefined;
  const search = "search" in from ? from.search : undefined;
  if (typeof pathname !== "string") return "/dashboard";
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.includes("?") ||
    pathname.includes("#") ||
    hasControlOrBackslash(pathname)
  ) {
    return "/dashboard";
  }
  const hash = "hash" in from ? from.hash : undefined;
  if (search !== undefined && search !== "" && (typeof search !== "string" || !search.startsWith("?") || hasControlOrBackslash(search))) return "/dashboard";
  if (hash !== undefined && hash !== "" && (typeof hash !== "string" || !hash.startsWith("#") || hasControlOrBackslash(hash))) return "/dashboard";
  return pathname + (search ?? "") + (hash ?? "");

}

export function Login() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const registering = params.get("mode") === "register";
  const [stage, setStage] = useState<Stage>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null);
  const [error, setError] = useState<AuthFailure | null>(null);
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStartingDemo, setIsStartingDemo] = useState(false);
  const { isAuthenticated, isInitializing, signIn } = useAuth();
  const navigate = useNavigate();
  const from = safeReturnTo(new URLSearchParams(location.search).get("returnTo") ?? safeAppFrom(location.state));

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || isStartingDemo) return;
    setNotice("");
    setError(null);
    setIsSubmitting(true);
    try {
      if (stage === "code" && challengeId !== null) {
        const completed = await completeLoginMfa({ challenge_id: challengeId, code: otp.trim() });
        signIn(completed.access_token);
        navigate(from, { replace: true });
        return;
      }
      if (stage === "enroll") {
        if (!enrollSecret) {
          const enrollment = await enrollMfa({ email: username, password });
          setEnrollSecret(enrollment.secret);
          setOtp("");
          return;
        }
        await confirmMfaEnrollment({ email: username, password, code: otp.trim() });
        setEnrollSecret(null);
        setOtp("");
        setStage("password");
        setNotice("Authenticator saved. Sign in to continue.");
        return;
      }
      if (registering) {
        await register({ email: username, password });
        changeMode(false);
        setNotice("Account created.");
      }
      const tokenResponse = await login({ username, password });
      if (tokenResponse.mfa_required) {
        setChallengeId(tokenResponse.challenge_id);
        setStage("code");
        setOtp("");
        return;
      }
      signIn(tokenResponse.access_token);
      navigate(from, { replace: true });
    } catch (err) {
      setError(authFailure(err, "Unable to continue. Check the connection and try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDemo() {
    setError(null);
    if (isStartingDemo || isSubmitting) return;
    setNotice("");
    setIsStartingDemo(true);
    try {
      const session = await startDemo();
      signIn(session.access_token);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(authFailure(err, "Unable to start the demo. Try again."));
    } finally {
      setIsStartingDemo(false);
    }
  }

  function changeMode(create: boolean) {
    const next = new URLSearchParams(location.search);
    if (create) next.set("mode", "register");
    else next.delete("mode");
    navigate({ pathname: "/login", search: next.toString(), hash: location.hash }, {state: location.state, replace: true});
  }

  function changeStage(next: Stage) {
    setStage(next);
    setChallengeId(null);
    setEnrollSecret(null);
    setOtp("");
    setError(null);
    setNotice("");
  }

  const enrollment = stage === "enroll";
  const needsCode = stage === "code" || (enrollment && enrollSecret != null);
  const busy = isSubmitting || isStartingDemo;
  const title = stage === "code" ? "Verify sign-in" : enrollment ? "Set up an authenticator" : registering ? "Create account" : "Sign in";
  const submit = stage === "code" ? "Verify code" : enrollment ? enrollSecret ? "Save authenticator" : "Get setup secret" : registering ? "Create account" : "Sign in";
  const demoAvailable = import.meta.env.VITE_DEMO_ENABLED !== "false";

  const entries = needsCode ? [{label:"Authenticator code",filled:/^[0-9]{6}$/.test(otp)}] :
    [{label:"Email",filled:username.trim().length > 0},{label:"Password",filled:password.length > 0}];
  const destinationPath = from.split(/[?#]/)[0];
  const destination = [...destinations, ...features].find(route => route.path === destinationPath)?.label ?? destinationPath;
  const entryStatus = isInitializing ? "Restoring session" : isStartingDemo ? "Starting demo" : isSubmitting ? "Checking entry" :
    error ? "Review entry" : entries.every(entry => entry.filled) ? "Ready to submit" : needsCode ? "Awaiting code" : "Awaiting credentials";

  return <Page title={title} className="login-page" description={stage === "code" ? "Enter the current six-digit code from your authenticator." :
    enrollment ? "Connect your account to an authenticator app." : registering ? "Create a personal paper-trading account." : "Access your paper portfolio and order history."}>
    <div className="auth-body">
      <LoginInstrument entries={entries} status={entryStatus} destination={"Destination · " + destination} resting={busy || isInitializing || Boolean(error)} />
      <Panel className="auth-credentials" title={needsCode ? "Authenticator" : "Credentials"}>
      <form onSubmit={handleSubmit} aria-label={title}>
        {!needsCode && <>
          <Field id="auth-email" label="Email" error={error?.fields.email}>
            <input autoComplete="username" type="email" name="username" value={username} data-testid="auth-email" required disabled={busy}
              onChange={e => {setUsername(e.target.value); setError(null);}} />
          </Field>
          <Field id="auth-password" label="Password" error={error?.fields.password}
            hint={registering ? "Use 8–72 characters and at least two character types. Avoid common passwords and your email name." : undefined}>
            <input autoComplete={registering ? "new-password" : "current-password"} type="password" name="password" value={password} data-testid="auth-password"
              required disabled={busy} minLength={registering ? 8 : undefined} maxLength={registering ? 72 : undefined}
              onChange={e => {setPassword(e.target.value); setError(null);}} />
          </Field>
        </>}
        {enrollSecret && <p>Add this secret to your authenticator app: <strong aria-label="Authenticator secret" className="auth-secret">{enrollSecret}</strong></p>}
        {needsCode && <Field id="auth-code" label={enrollment ? "Enrollment code" : "Sign-in code"} error={error?.fields.code}>
          <input autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={otp} disabled={busy}
            onChange={e => {setOtp(e.target.value); setError(null);}} />
        </Field>}
        {error && <p className="auth-message" role="alert">{error.message}</p>}
        {notice && <p role="status">{notice}</p>}
        <Button variant="primary" type="submit" data-testid="auth-submit" disabled={busy || isInitializing} busy={isSubmitting}>
          {isSubmitting ? "Please wait…" : submit}
        </Button>
      </form>
      <div className="auth-links">
        {stage === "password" && <button type="button" className="auth-link" disabled={busy} onClick={() => {changeStage("password"); changeMode(!registering);}}>
          {registering ? "Already have an account? Sign in" : "Need an account? Create one"}</button>}
        {!registering && <button type="button" className="auth-link" disabled={busy}
          onClick={() => changeStage(stage === "password" ? "enroll" : "password")}>{stage === "password" ? "Set up an authenticator" : "Back to sign in"}</button>}
      </div>
    </Panel>
    <aside className="auth-aside"><div><h2>{demoAvailable ? "Try a paper portfolio" : "Explore markets"}</h2>
      <p>{demoAvailable ? "Start a separate demo with a skippable one-share walkthrough." : "Browse cached prices and company history before signing in."}</p></div>
      {demoAvailable ? <Button disabled={busy || isInitializing} busy={isStartingDemo} data-testid="demo-start" onClick={handleDemo}>
        {isStartingDemo ? "Starting demo…" : "Try the demo"}
      </Button> : <Link className="nk-button" to="/market">Open markets</Link>}
    </aside></div>
    <div className="auth-links"><Link className="auth-link" to="/market">Back to markets</Link>
      {features.some(feature => feature.id === "learn") && <Link className="auth-link" to="/learn">Learn about paper trading</Link>}
    </div>
  </Page>;
}
