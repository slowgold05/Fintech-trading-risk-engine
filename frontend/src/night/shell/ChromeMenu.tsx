import type { RefObject } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "../../api/auth";
import { MarketSearch } from "../../components/MarketSearch";
import { useAuth } from "../../context/useAuth";
import { Button, Sheet } from "../kit";
import { allowed, destinations, features } from "../registry";

export default function ChromeMenu({ type, close, opener }: {
  type: "commands" | "account"; close: () => void; opener: RefObject<HTMLButtonElement | null>;
}) {
  const { isAuthenticated, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const identity = useQuery({ queryKey: ["me"], queryFn: fetchMe, enabled: isAuthenticated, retry: false, staleTime: 60_000 });

  if (type === "commands") {
    return <Sheet open onOpenChange={close} returnFocusRef={opener} title="Find a market or page" data-testid="command-dialog">
      <div onClick={event => { if ((event.target as Element).closest("a")) close(); }}>
        <MarketSearch />
        <nav className="night-link-list">{[...destinations, ...features].filter(route => allowed(route.access, identity.data)).map(route =>
          <Link key={route.id} to={route.path} aria-current={pathname === route.path ? "page" : undefined}>{route.label}</Link>)}</nav>
      </div>
    </Sheet>;
  }
  return <Sheet open onOpenChange={close} returnFocusRef={opener} title="Account">
    <p>{identity.data?.is_demo ? "Demo portfolio" : identity.data?.display_name || identity.data?.role || "Signed in"}</p>
    <nav className="night-link-list">
      <Link to="/portfolio" onClick={close}>Portfolio</Link>
      <Button data-testid="sign-out" onClick={() => { close(); signOut(); navigate("/login"); }}>Sign out</Button>
    </nav>
  </Sheet>;
}
