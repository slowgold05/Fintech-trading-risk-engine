import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startDemo } from "../../api/auth";
import { useAuth } from "../../context/useAuth";
import { useLook } from "../looks/preferences";
import { Button } from "../kit";

const ChromeMenu = lazy(() => import("./ChromeMenu"));

export function ChromeTools({ market = false }: { market?: boolean }) {
  const { prefs, update } = useLook();
  const { isAuthenticated, isInitializing, signIn } = useAuth();
  const navigate = useNavigate();
  const [dialog,setDialog] = useState<"commands"|"account"|null>(null);
  const [busy,setBusy] = useState(false);
  const [failure,setFailure] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const account = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setDialog(current => current === "commands" ? null : "commands");
      }
    }
    document.addEventListener("keydown",shortcut);
    return () => document.removeEventListener("keydown",shortcut);
  }, []);
  async function demo() {
    if (busy || isInitializing) return;
    setBusy(true); setFailure("");
    try { const session = await startDemo(); signIn(session.access_token); navigate("/dashboard"); }
    catch { setFailure("Demo could not start. Try again."); }
    finally { setBusy(false); }
  }
  const target = prefs.look === "terrain" ? "Dial" : "Terrain";
  return <div className="night-tools">
    <button type="button" ref={trigger} className="nk-button" aria-label="Open command menu" data-testid="command-open" onClick={() => setDialog("commands")}><span aria-hidden="true">⌘ K</span></button>
    <Button data-testid="look-toggle" aria-label={`Switch to ${target}`} onClick={() => update("look",prefs.look === "terrain" ? "dial" : "terrain")}>{target}</Button>
    {isAuthenticated ? <button type="button" ref={account} className="nk-button" data-testid="account-menu" onClick={() => setDialog("account")}>Account</button> :
      market && import.meta.env.VITE_DEMO_ENABLED !== "false" && <Button variant="primary" data-testid="demo-start" disabled={isInitializing} busy={busy} onClick={demo}>{busy ? "Starting…" : "Try the demo"}</Button>}
    {failure && <span role="alert">{failure}</span>}
    {dialog && <Suspense fallback={null}>
      <ChromeMenu key={dialog} type={dialog} opener={dialog === "commands" ? trigger : account} close={() => setDialog(null)} />
    </Suspense>}
  </div>;
}
