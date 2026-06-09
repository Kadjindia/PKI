import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  currentInitials?: string;
  onSaveProfile?: (initials: string) => void;
}

export default function ProfileModal({ isOpen, onClose, userEmail, currentInitials, onSaveProfile }: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'auth'>('info');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // États du formulaire allégés (plus de checkboxes)
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [initials, setInitials] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('Auditeur');

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      fetchUserProfile();
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const fetchUserProfile = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (data && !error) {
        setFirstName(data.first_name || '');
        setLastName(data.last_name || '');
        setInitials(data.initials || currentInitials || '');
        setTitle(data.title || '');
        if (data.role) setRole(data.role);
      }
    }
    setIsLoading(false);
  };

const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { error } = await supabase
        .from('users')
        .upsert({
          id: user.id, // OBLIGATOIRE : On précise l'ID pour la création
          first_name: firstName,
          last_name: lastName,
          initials: initials.toUpperCase(),
          title: title,
        }); // Pas besoin du .eq() avec upsert sur la clé primaire

      if (!error) {
        if (onSaveProfile) onSaveProfile(initials.toUpperCase());
        localStorage.setItem('userInitials', initials.toUpperCase());
        onClose();
      } else {
        console.error("Erreur de sauvegarde :", error.message);
      }
    }
    setIsSaving(false);
  };

  const displayName = firstName || lastName ? `${firstName} ${lastName}` : (userEmail?.split('@')[0] || 'Utilisateur');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

      <div className="relative bg-white dark:bg-slate-900 w-full max-w-3xl rounded-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{displayName}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex px-6 pt-4 border-b border-slate-200 dark:border-slate-800 gap-2">
          <button onClick={() => setActiveTab('info')} className={`px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${activeTab === 'info' ? 'bg-[#0f4a56] text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Informations</button>
          <button onClick={() => setActiveTab('auth')} className={`px-4 py-2 text-sm font-semibold rounded-t-md transition-colors border border-b-0 border-transparent ${activeTab === 'auth' ? 'bg-[#0f4a56] text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Authentification forte</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
               <Loader2 className="w-8 h-8 animate-spin text-[#0f4a56]" />
            </div>
          ) : activeTab === 'info' ? (
            <form id="profile-form" onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="md:col-span-3 mt-2">
                  <label className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">Email</label>
                  <div className="text-sm text-slate-600 dark:text-slate-400">{userEmail}</div>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div>
                  <label className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Prénom <span className="text-slate-800 dark:text-slate-200">*</span></label>
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f4a56]/50 focus:border-[#0f4a56] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Nom</label>
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f4a56]/50 focus:border-[#0f4a56] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Initiales</label>
                  <input type="text" value={initials} onChange={(e) => setInitials(e.target.value)} maxLength={3} placeholder="ex: JB" className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f4a56]/50 focus:border-[#0f4a56] uppercase transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Titre</label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f4a56]/50 focus:border-[#0f4a56] transition-all" />
                </div>
              </div>
            </form>
          ) : (
            <div className="py-8 text-center text-slate-500">Paramètres d'authentification forte à venir.</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-md transition-colors">Annuler</button>
          <button type="submit" form="profile-form" disabled={isSaving || isLoading} className="px-4 py-2 flex items-center gap-2 text-sm font-semibold text-[#0f4a56] border border-[#0f4a56] hover:bg-[#0f4a56] hover:text-white transition-colors rounded-md disabled:opacity-50">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer
          </button>
        </div>

      </div>
    </div>
  );
}