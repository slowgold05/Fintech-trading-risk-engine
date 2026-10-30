import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  clearAuthToken,
  setAuthToken,
  setTokenRefreshHandler,
  setUnauthorizedHandler,
} from "../api/client";
import { logout, refreshSession } from "../api/auth";
import { AuthContext } from "./authState";

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const value = useMemo(
    () => ({
      token,
      isAuthenticated: Boolean(token),
      isInitializing,
      signIn: (nextToken: string) => {
        setToken(nextToken);
        setAuthToken(nextToken);
      },
      signOut: () => {
        void logout().catch(() => undefined);
        setToken(null);
        clearAuthToken();
      },
    }),
    [isInitializing, token],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
    });
    setTokenRefreshHandler((nextToken) => {
      setToken(nextToken);
    });

    return () => {
      setUnauthorizedHandler(null);
      setTokenRefreshHandler(null);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    refreshSession()
      .then((tokenResponse) => {
        if (cancelled) {
          return;
        }
        setToken(tokenResponse.access_token);
        setAuthToken(tokenResponse.access_token);
      })
      .catch(() => {
        clearAuthToken();
      })
      .finally(() => {
        if (!cancelled) {
          setIsInitializing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
