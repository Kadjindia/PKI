import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

// Providers
import { KpiProvider } from "@/context/KpiContext";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";

// Layout & Security
import PrivateRoute from "@/components/PrivateRoute"; // Ton composant PrivateRoute
import AppLayout from "@/components/layout/AppLayout";

// Pages
import Login from "./pages/Login";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import Index from "./pages/Index";
import DataEntry from "./pages/DataEntry";
import Alerts from "./pages/Alerts";
import Connectors from "./pages/Connectors";
import Governance from "./pages/Governance";
import SecurityOps from "./pages/SecurityOps";
import Awareness from "./pages/Awareness";
import Messagerie from "./pages/Messagerie";
import Risks from "./pages/Risks";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <KpiProvider>
          <BrowserRouter>
            <Routes>
              {/* Routes Publiques */}
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* Routes Privées enveloppées par AppLayout */}
              <Route path="/*" element={
                <PrivateRoute>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/saisie" element={<DataEntry />} />
                      <Route path="/alertes" element={<Alerts />} />
                      <Route path="/connecteurs" element={<Connectors />} />
                      <Route path="/gouvernance" element={<Governance />} />
                      <Route path="/security-ops" element={<SecurityOps />} />
                      <Route path="/sensibilisation" element={<Awareness />} />
                      <Route path="/messagerie" element={<Messagerie />} />
                      <Route path="/risques" element={<Risks />} />
                      <Route path="/parametres" element={<Settings />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AppLayout>
                </PrivateRoute>
              } />
            </Routes>
          </BrowserRouter>
        </KpiProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;