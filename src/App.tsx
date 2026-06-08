import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { KpiProvider } from "@/context/KpiContext";
import { AuthProvider } from "@/context/AuthContext";
import Login from "./pages/Login";
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
    {/* AuthProvider doit être à la racine pour englober tout le reste */}
    <AuthProvider>
      <KpiProvider>
        <BrowserRouter>
          <Routes>
            {/* Route publique */}
            <Route path="/login" element={<Login />} />

            {/* Routes privées - Pas besoin de AuthGuard complexe ici,
                si tu veux rediriger, on le gère directement dans tes pages
                ou via une simple vérification dans chaque page */}
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
        </BrowserRouter>
      </KpiProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;