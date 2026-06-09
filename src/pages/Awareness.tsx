import AppLayout from "@/components/layout/AppLayout";
import AwarenessView from "@/components/security/AwarenessView";

const Awareness = () => {
  return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sensibilisation & Phishing</h1>
          <p className="text-muted-foreground mt-2">
            Import des campagnes d'hameçonnage et suivi des formations.
          </p>
        </div>
        <AwarenessView />
      </div>
  );
};

export default Awareness;