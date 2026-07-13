import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import Companies from "@/pages/Companies";
import Login from "@/pages/Login";
import { useSaasStore } from "@/hooks/useSaasStore";

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const session = useSaasStore((state) => state.session);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  const session = useSaasStore((state) => state.session);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to={session ? "/dashboard" : "/login"} replace />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/empresas"
          element={
            <ProtectedRoute>
              <Companies />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to={session ? "/dashboard" : "/login"} replace />} />
      </Routes>
    </Router>
  );
}
