# Frontend Scaffold Handoff

Frontend scaffold files live in `frontend/` for a React + Vite + TypeScript + Tailwind CSS app.

Created structure:

```text
frontend/src/api
frontend/src/components
frontend/src/context
frontend/src/pages
frontend/src/types
frontend/src/utils
```

Initial routes/pages:

- `/login` -> `frontend/src/pages/Login.tsx`
- `/dashboard` -> `frontend/src/pages/Dashboard.tsx`
- `/trades` -> `frontend/src/pages/Trades.tsx`
- `/portfolio` -> `frontend/src/pages/Portfolio.tsx`
- `/risk` -> `frontend/src/pages/Risk.tsx`

Layout:

- `frontend/src/components/AppShell.tsx` provides top navigation for the main app routes.
- `frontend/src/App.tsx` defines the React Router routes.

Placeholder API files:

- `frontend/src/api/client.ts`
- `frontend/src/api/auth.ts`
- `frontend/src/api/trades.ts`
- `frontend/src/api/portfolio.ts`
- `frontend/src/api/risk.ts`
- `frontend/src/api/index.ts`

Completed verification:

```powershell
npm.cmd install
npm.cmd run lint
npm.cmd run build
```

Run those commands from `frontend/`.

Notes:

- `npm install` was attempted with `npm.cmd` because PowerShell blocks the `npm.ps1` shim on this machine.
- Dependencies are now installed and `package-lock.json` has been created.
- `npm.cmd run lint` passes.
- `npm.cmd run build` passes when run with filesystem permissions that allow Vite/esbuild to load `vite.config.ts`.
- npm reports 1 low severity advisory. Run `npm.cmd audit` for details before deciding whether to apply `npm audit fix`.
