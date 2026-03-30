import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KpiProvider } from "@/context/KpiContext";
import Index from "./pages/Index";
import DataEntry from "./pages/DataEntry";
import Alerts from "./pages/Alerts";
import Connectors from "./pages/Connectors";
import NotFound from "./pages/NotFound";
import Governance from "./pages/Governance";
import SecurityOps from "./pages/SecurityOps";
import Awareness from "./pages/Awareness";
import Settings from "./pages/Settings";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <KpiProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/saisie" element={<DataEntry />} />
            <Route path="/alertes" element={<Alerts />} />
            <Route path="/connecteurs" element={<Connectors />} />
            <Route path="/gouvernance" element={<Governance />} />
            <Route path="/security-ops" element={<SecurityOps />} />
            <Route path="/sensibilisation" element={<Awareness />} /> {/* <-- NOUVEAU */}
            <Route path="/parametres" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </KpiProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;