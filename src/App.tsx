import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

// Providers
import { KpiProvider } from "@/context/KpiContext";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";

// Layout & Security
import PrivateRoute from "@/components/PrivateRoute";
import AppLayout from "@/components/layout/AppLayout";
import IdleTimeout from './components/IdleTimeout';

// Pages
import Login from "./pages/Login";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ChangePasswordPage from "./pages/ChangePasswordPage"
import Index from "./pages/Index";
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
            {/* Le minuteur d'inactivité est placé ici, il surveillera toutes les routes */}
            <IdleTimeout timeoutInMinutes={15} />

            <Routes>
              {/* Routes Publiques */}
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/change-password" element={<ChangePasswordPage />} />

              {/* Routes Privées enveloppées par AppLayout */}
              <Route path="/*" element={
                <PrivateRoute>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Index />} />
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