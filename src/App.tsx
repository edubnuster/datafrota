import { useEffect } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import AccountSettings from "@/pages/AccountSettings";
import Dashboard from "@/pages/Dashboard";
import CompanyDashboard from "@/pages/CompanyDashboard";
import CompanyPdvs from "@/pages/CompanyPdvs";
import CompanySettings from "@/pages/CompanySettings";
import Companies from "@/pages/Companies";
import Login from "@/pages/Login";
import Promotions from "@/pages/Promotions";
import { useSaasStore } from "@/hooks/useSaasStore";

type AllowedRole = "saas_admin" | "company_admin";

function getDefaultRoute(role: AllowedRole) {
  return role === "company_admin" ? "/empresa/dashboard" : "/dashboard";
}

function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: JSX.Element;
  allowedRoles?: AllowedRole[];
}) {
  const session = useSaasStore((state) => state.session);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return <Navigate to={getDefaultRoute(session.role)} replace />;
  }

  return children;
}

export default function App() {
  const session = useSaasStore((state) => state.session);
  const companiesLoaded = useSaasStore((state) => state.companiesLoaded);
  const loadCompanies = useSaasStore((state) => state.loadCompanies);

  useEffect(() => {
    if (!session || session.role !== "saas_admin") {
      return;
    }

    void loadCompanies(!companiesLoaded);
  }, [companiesLoaded, loadCompanies, session]);

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={<Navigate to={session ? getDefaultRoute(session.role) : "/login"} replace />}
        />
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={["saas_admin"]}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/empresas"
          element={
            <ProtectedRoute allowedRoles={["saas_admin"]}>
              <Companies />
            </ProtectedRoute>
          }
        />
        <Route
          path="/minha-conta"
          element={
            <ProtectedRoute allowedRoles={["saas_admin"]}>
              <AccountSettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/empresa/dashboard"
          element={
            <ProtectedRoute allowedRoles={["company_admin"]}>
              <CompanyDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/empresa/promocoes"
          element={
            <ProtectedRoute allowedRoles={["company_admin"]}>
              <Promotions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/empresa/pdvs"
          element={
            <ProtectedRoute allowedRoles={["company_admin"]}>
              <CompanyPdvs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/empresa/configuracoes"
          element={
            <ProtectedRoute allowedRoles={["company_admin"]}>
              <CompanySettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/promocoes"
          element={<Navigate to={session ? getDefaultRoute(session.role) : "/login"} replace />}
        />
        <Route
          path="*"
          element={<Navigate to={session ? getDefaultRoute(session.role) : "/login"} replace />}
        />
      </Routes>
    </Router>
  );
}
