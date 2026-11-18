import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, startDemo } from "../../api/auth";
import { MarketSearch } from "../../components/MarketSearch";
import { useAuth } from "../../context/useAuth";
import { useLook } from "../looks/preferences";
import { Button, Sheet } from "../kit";
import { allowed, destinations, features } from "../registry";

export function ChromeTools({ market = false }: { market?: boolean }) {
  const { prefs, update } = useLook();
  const { isAuthenticated, isInitializing, signIn, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [dialog,setDialog] = useState<"commands"|"account"|null>(null);
  const [busy,setBusy] = useState(false);
  const [failure,setFailure] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const account = useRef<HTMLButtonElement>(null);
  const identity = useQuery({queryKey:["me"],queryFn:fetchMe,enabled:isAuthenticated,retry:false,staleTime:60000});
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
    <Sheet open={dialog === "commands"} onOpenChange={() => setDialog(null)} returnFocusRef={trigger} title="Find a market or page" data-testid="command-dialog">
      <div onClick={event => { if ((event.target as Element).closest("a")) setDialog(null); }}><MarketSearch />
        <nav className="night-link-list">{[...destinations,...features].filter(route => allowed(route.access,identity.data)).map(route =>
          <Link key={route.id} to={route.path} aria-current={pathname === route.path ? "page" : undefined}>{route.label}</Link>)}</nav>
      </div>
    </Sheet>
    <Sheet open={dialog === "account"} onOpenChange={() => setDialog(null)} returnFocusRef={account} title="Account">
      <p>{identity.data?.is_demo ? "Demo portfolio" : identity.data?.display_name || identity.data?.role || "Signed in"}</p>
      <nav className="night-link-list"><Link to="/portfolio" onClick={() => setDialog(null)}>Portfolio</Link>
        <Button data-testid="sign-out" onClick={() => { setDialog(null); signOut(); navigate("/login"); }}>Sign out</Button>
      </nav>
    </Sheet>
  </div>;
}
