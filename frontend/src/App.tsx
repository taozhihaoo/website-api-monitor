import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";

import { Spinner } from "./components/Feedback";
import { Layout } from "./components/Layout";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { I18nProvider, useI18n } from "./i18n/I18nContext";
import { DashboardPage } from "./pages/DashboardPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { MonitorDetailPage } from "./pages/MonitorDetailPage";
import { MonitorsPage } from "./pages/MonitorsPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Dev-only diagnostics handle: lets E2E tests introspect cache state.
// Import.meta.env.DEV is statically false in production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __queryClient: QueryClient }).__queryClient = queryClient;
}

function BootScreen() {
  const { t } = useI18n();
  return (
    <div className="sw-shell flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="sw-brand-mark !h-12 !w-12">
          <span className="text-lg font-bold">S</span>
        </div>
        <Spinner label={t("feedback.signingIn")} />
      </div>
    </div>
  );
}

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) {
    return <BootScreen />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Layout />;
}

function PublicOnlyRoutes() {
  const { user, loading } = useAuth();
  if (loading) {
    return <BootScreen />;
  }
  if (user) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<PublicOnlyRoutes />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
              </Route>
              <Route element={<ProtectedRoutes />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/monitors" element={<MonitorsPage />} />
                <Route path="/monitors/:id" element={<MonitorDetailPage />} />
                <Route path="/incidents" element={<IncidentsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
