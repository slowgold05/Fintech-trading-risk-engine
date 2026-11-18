import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { LookProvider } from "./night/looks/LookProvider";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastProvider";
import { useToast } from "./context/useToast";
import "./index.css";

// AuthProvider calls clear() when the identity ends or changes. Only known
// public reads can survive that transition; all mutations are session-scoped.
class SessionQueryClient extends QueryClient {
  override clear() {
    const publicMarket = new Set(["overview","heatmap","trending","news","data-status","research"]);
    this.removeQueries({ predicate: ({queryKey: [scope, resource]}) => {
      if (scope === "market") return !publicMarket.has(String(resource));
      if (scope === "universe") return resource !== "public";
      return !["quote","history","indicators"].includes(String(scope));
    }});
    this.getMutationCache().clear();
  }
}
const queryClient = new SessionQueryClient();

const Toaster = lazy(() => import("./components/Toaster").then(module => ({ default: module.Toaster })));

// This component is mounted only by the application entry point.
// eslint-disable-next-line react-refresh/only-export-components
function Notifications() {
  const { toasts } = useToast();
  return toasts.length > 0 && <Suspense fallback={null}><Toaster /></Suspense>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <LookProvider><App /></LookProvider>
              <Notifications />
            </ErrorBoundary>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
