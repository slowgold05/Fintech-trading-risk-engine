import { createContext } from "react";

export type AuthContextValue = {
  token: string | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  signIn: (token: string) => void;
  signOut: () => void;
};

export const AuthContext = createContext<AuthContextValue>({
  token: null,
  isAuthenticated: false,
  isInitializing: true,
  signIn: () => undefined,
  signOut: () => undefined,
});
