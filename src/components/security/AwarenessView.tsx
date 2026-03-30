import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPhishingCampaigns, createPhishingCampaign, deletePhishingCampaign,
  fetchElearningModules, createElearningModule, updateElearningModule, deleteElearningModule,
  PhishingCampaign, ElearningModule
} from "@/lib/supabase-awareness";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { ShieldAlert, GraduationCap, Users, Loader2, Trash2, Plus, AlertTriangle, Upload } from "lucide-react";

export default function AwarenessView() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("phishing");

  const [isAddCampaignOpen, setIsAddCampaignOpen] = useState(false);
  const [isAddModuleOpen, setIsAddModuleOpen] = useState(false);

  const [newCampaign, setNewCampaign] = useState({
    name: "", sendDate: "", difficulty: "moyen", targetCount: 0, clickedCount: 0,
    compromisedCount: 0, reportedCount: 0, recidivistsCount: 0, failedEmails: [] as string[], fileLoaded: false
  });
  const [newModule, setNewModule] = useState({ name: "", targetAudience: "Tous", totalAssigned: 100, deadline: "" });

  const { data: campaigns = [], isLoading: isLoadingCampaigns } = useQuery({ queryKey: ['phishing'], queryFn: fetchPhishingCampaigns });
  const { data: modules = [], isLoading: isLoadingModules } = useQuery({ queryKey: ['elearning'], queryFn: fetchElearningModules });

  const addCampaignMutation = useMutation({
    mutationFn: createPhishingCampaign,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['phishing'] }); toast.success("Campagne enregistrée"); setIsAddCampaignOpen(false); setNewCampaign({ name: "", sendDate: "", difficulty: "moyen", targetCount: 0, clickedCount: 0, compromisedCount: 0, reportedCount: 0, recidivistsCount: 0, failedEmails: [], fileLoaded: false }); }
  });
  const delCampaignMutation = useMutation({ mutationFn: deletePhishingCampaign, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['phishing'] }); toast.success("Campagne supprimée"); } });

  const addModuleMutation = useMutation({
    mutationFn: createElearningModule,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); toast.success("Module ajouté"); setIsAddModuleOpen(false); }
  });
  const updateModuleMutation = useMutation({ mutationFn: ({ id, updates }: { id: string, updates: Partial<ElearningModule> }) => updateElearningModule(id, updates), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); toast.success("Mise à jour effectuée"); } });
  const delModuleMutation = useMutation({ mutationFn: deleteElearningModule, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['elearning'] }); toast.success("Module supprimé"); } });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      let target = 0, clicked = 0, compromised = 0, reported = 0;
      let failed: string[] = [];

      lines.forEach((line, index) => {
        if (index === 0 || !line.trim()) return;
        const cols = line.split(',');
        if (cols.length < 2) return;
        const email = cols[0].trim().toLowerCase();
        const status = cols[1].trim().toLowerCase();

        target++;
        if (status.includes('cliqu') || status.includes('click')) { clicked++; failed.push(email); }
        else if (status.includes('compromis') || status.includes('saisi')) { compromised++; failed.push(email); }
        else if (status.includes('signal') || status.includes('report')) { reported++; }
      });

      const previousFailed = campaigns.length > 0 ? campaigns[0].failedEmails || [] : [];
      const recidivists = failed.filter(email => previousFailed.includes(email)).length;

      setNewCampaign(prev => ({ ...prev, targetCount: target, clickedCount: clicked, compromisedCount: compromised, reportedCount: reported, recidivistsCount: recidivists, failedEmails: failed, fileLoaded: true }));
      toast.success("Fichier CSV analysé !");
    };
    reader.readAsText(file);
  };

  if (isLoadingCampaigns || isLoadingModules) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6">

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taux de compromission</CardTitle>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns.length > 0 ? Math.round((campaigns[0].compromisedCount / campaigns[0].targetCount) * 100) : 0}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taux de signalement</CardTitle>
            <ShieldAlert className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns.length > 0 ? Math.round((campaigns[0].reportedCount / campaigns[0].targetCount) * 100) : 0}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Récidivistes</CardTitle>
            <Users className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns.length > 0 ? campaigns[0].recidivistsCount : 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* TABS */}
      <Card className="shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-6 pt-4 border-b flex justify-between items-center">
            <TabsList className="bg-transparent space-x-4">
              <TabsTrigger value="phishing" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-3">Phishing</TabsTrigger>
              <TabsTrigger value="elearning" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none pb-3">E-Learning</TabsTrigger>
            </TabsList>
            <Button size="sm" onClick={() => activeTab === "phishing" ? setIsAddCampaignOpen(true) : setIsAddModuleOpen(true)} className="mb-2">
              <Plus className="w-4 h-4 mr-2" /> {activeTab === "phishing" ? "Importer CSV" : "Nouveau Module"}
            </Button>
          </div>

          <TabsContent value="phishing" className="m-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scénario</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Cibles</TableHead>
                  <TableHead>Compromis</TableHead>
                  <TableHead>Récidivistes</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{new Date(c.sendDate).toLocaleDateString()}</TableCell>
                    <TableCell>{c.targetCount}</TableCell>
                    <TableCell className="text-rose-500 font-bold">{c.compromisedCount} ({Math.round((c.compromisedCount/c.targetCount)*100)}%)</TableCell>
                    <TableCell className="text-amber-500">{c.recidivistsCount}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => delCampaignMutation.mutate(c.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="elearning" className="m-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Cible</TableHead>
                  <TableHead>Avancement</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modules.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.targetAudience}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input type="number" className="w-20 h-8" value={m.completedCount} onChange={(e) => updateModuleMutation.mutate({id: m.id, updates: {completedCount: parseInt(e.target.value)||0}})} />
                        <span>/ {m.totalAssigned}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => delModuleMutation.mutate(m.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </Card>

      {/* MODALES */}
      <Dialog open={isAddCampaignOpen} onOpenChange={setIsAddCampaignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Importer résultats Phishing</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nom du Scénario</Label><Input value={newCampaign.name} onChange={(e) => setNewCampaign({...newCampaign, name: e.target.value})} /></div>
            <div className="space-y-2"><Label>Date d'envoi</Label><Input type="date" value={newCampaign.sendDate} onChange={(e) => setNewCampaign({...newCampaign, sendDate: e.target.value})} /></div>
            <div className="space-y-2"><Label>Difficulté</Label><Select value={newCampaign.difficulty} onValueChange={(v:any) => setNewCampaign({...newCampaign, difficulty: v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="facile">Facile</SelectItem><SelectItem value="moyen">Moyen</SelectItem><SelectItem value="difficile">Difficile</SelectItem></SelectContent></Select></div>
            <div className="space-y-2 border-t pt-4">
              <Label className="flex items-center gap-2"><Upload className="w-4 h-4"/> Fichier CSV (email, statut)</Label>
              <Input type="file" accept=".csv" onChange={handleFileUpload} />
            </div>
            {newCampaign.fileLoaded && (
              <div className="bg-muted p-3 text-sm">Cibles: {newCampaign.targetCount} | Compromis: <span className="text-rose-500 font-bold">{newCampaign.compromisedCount}</span> | Récidivistes: <span className="text-amber-500 font-bold">{newCampaign.recidivistsCount}</span></div>
            )}
            <Button className="w-full" disabled={!newCampaign.fileLoaded || !newCampaign.name} onClick={() => addCampaignMutation.mutate(newCampaign as any)}>Enregistrer</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddModuleOpen} onOpenChange={setIsAddModuleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouveau Module E-Learning</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nom</Label><Input value={newModule.name} onChange={(e) => setNewModule({...newModule, name: e.target.value})} /></div>
            <div className="space-y-2"><Label>Cible</Label><Input value={newModule.targetAudience} onChange={(e) => setNewModule({...newModule, targetAudience: e.target.value})} /></div>
            <div className="space-y-2"><Label>Assignations</Label><Input type="number" value={newModule.totalAssigned} onChange={(e) => setNewModule({...newModule, totalAssigned: parseInt(e.target.value)||1})} /></div>
            <Button className="w-full" onClick={() => addModuleMutation.mutate(newModule as any)}>Créer</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}