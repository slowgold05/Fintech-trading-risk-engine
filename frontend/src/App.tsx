import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "./api/auth";
import { useAuth } from "./context/useAuth";
import { Home } from "./pages/Home";
import { State } from "./night/kit";
import { ChromeTools } from "./night/shell/ChromeTools";
import { allowed, features, type Access } from "./night/registry";

const AppShell = lazy(() => import("./components/AppShell").then(m => ({default:m.AppShell})));
const Dashboard = lazy(() => import("./pages/Dashboard").then(m => ({default:m.Dashboard})));
const ForecastLab = lazy(() => import("./pages/ForecastLab"));
const StockDetail = lazy(() => import("./pages/StockDetail").then(m => ({default:m.StockDetail})));
const Login = lazy(() => import("./pages/Login").then(m => ({default:m.Login})));
const Portfolio = lazy(() => import("./pages/Portfolio").then(m => ({default:m.Portfolio})));
const Research = lazy(() => import("./pages/Research").then(m => ({default:m.Research})));
const Risk = lazy(() => import("./pages/Risk").then(m => ({default:m.Risk})));
const Trades = lazy(() => import("./night/shell/ActivityRoute"));
const Compliance = lazy(() => import("./pages/Compliance").then(m => ({default:m.Compliance})));

function Index() {
  const { isAuthenticated, isInitializing } = useAuth();
  if (isInitializing) return <State kind="loading" title="Restoring session…" />;
  return <Navigate to={isAuthenticated ? "/dashboard" : "/market"} replace />;
}
function Gate({ access = "authenticated", children }: { access?: Access; children?: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const needsRole = access !== "public" && access !== "authenticated";
  const identity = useQuery({ queryKey: ["me"], queryFn: fetchMe, enabled: needsRole && auth.isAuthenticated, retry:false });
  if (access === "public") return children ?? <Outlet />;
  if (auth.isInitializing) return <State kind="loading" title="Restoring session…" />;
  if (!auth.isAuthenticated) {
    const target = location.pathname + location.search + location.hash;
    return <Navigate replace to={"/login?returnTo=" + encodeURIComponent(target)} state={{from:location}} />;
  }
  if (needsRole && identity.isPending) return <State kind="loading" title="Checking access…" />;
  if (needsRole && identity.isError) return <State kind="error" title="Account access could not be checked." action={<button onClick={() => void identity.refetch()}>Retry</button>} />;
  if (needsRole && !allowed(access,identity.data)) return <section data-testid="night-forbidden"><h1>Access restricted</h1><p>Your role cannot open this page.</p></section>;
  return children ?? <Outlet />;
}
function Screen({ id, children }: { id: string; children: ReactNode }) {
  return <section className="night-screen" data-testid={`night-${id}`}>{children}</section>;
}
function PublicShell() {
  return <><header className="night-market-tools"><a href="/market">Sentinel Markets</a><ChromeTools /></header><Outlet /></>;
}
export default function App() {
  return <Suspense fallback={<State kind="loading" title="Loading page…" />}>
    <Routes>
      <Route index element={<Index />} />
      <Route path="/market" element={<Home />} />
      <Route element={<PublicShell />}>
        <Route path="/market/:symbol" element={<Screen id="company"><StockDetail /></Screen>} />
        <Route path="/login" element={<Screen id="login"><Login /></Screen>} />
        {features.filter(f => f.access === "public" && !f.slot).map(({path,Screen:Feature}) => <Route key={path} path={path} element={<Feature />} />)}
      </Route>
      <Route element={<Gate />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Screen id="today"><Dashboard /></Screen>} />
          <Route path="/trades" element={<Screen id="activity"><Trades /></Screen>} />
          <Route path="/portfolio" element={<Screen id="portfolio"><Portfolio /></Screen>} />
          <Route path="/risk" element={<Screen id="risk"><Risk /></Screen>} />
          <Route path="/research" element={<Screen id="research"><Research /></Screen>} />
          <Route path="/forecasts" element={<Screen id="forecasts"><ForecastLab /></Screen>} />
          <Route path="/compliance" element={<Gate access="privileged"><Screen id="compliance"><Compliance /></Screen></Gate>} />
          {features.filter(f => f.access !== "public" && !f.slot).map(({path,access,Screen:Feature}) => <Route key={path} path={path} element={<Gate access={access}><Feature /></Gate>} />)}
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  </Suspense>;
}
