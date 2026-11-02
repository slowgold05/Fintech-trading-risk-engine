import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Dashboard } from "./pages/Dashboard";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Portfolio } from "./pages/Portfolio";
import { Risk } from "./pages/Risk";
import { Trades } from "./pages/Trades";
import { Compliance } from "./pages/Compliance";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/risk" element={<Risk />} />
          <Route path="/compliance" element={<Compliance />} />
        </Route>
      </Route>
    </Routes>
  );
}
