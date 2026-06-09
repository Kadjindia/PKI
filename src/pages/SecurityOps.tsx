import AppLayout from "@/components/layout/AppLayout";
import SecurityOpsView from "@/components/security/SecurityOpsView";

export default function SecurityOps() {
  return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plans d'Assurance Sécurité & Audits</h1>
          <p className="text-muted-foreground mt-1">
            Suivi des PAS et registre des Audits.
          </p>
        </div>
        <SecurityOpsView />
      </div>
  );
}