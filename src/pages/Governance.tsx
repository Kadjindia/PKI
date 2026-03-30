// src/pages/Governance.tsx
import AppLayout from "@/components/layout/AppLayout";
import GovernanceView from "@/components/gouvernance/GovernanceView";

export default function Governance() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gouvernance SSI</h1>
          <p className="text-muted-foreground mt-1">
            Pilotage du référentiel documentaire et suivi des écarts.
          </p>
        </div>
        <GovernanceView />
      </div>
    </AppLayout>
  );
}