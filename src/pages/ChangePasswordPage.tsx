import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Lock, Loader2, ShieldCheck, KeyRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    // 1. Validations basiques
    if (newPassword.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      setLoading(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Les nouveaux mots de passe ne correspondent pas.");
      setLoading(false);
      return;
    }
    if (!user || !user.email) {
      setError("Impossible de vérifier l'utilisateur actuel.");
      setLoading(false);
      return;
    }

    // 2. Vérification du mot de passe actuel (Astuce Supabase)
    // On essaie de "connecter" l'utilisateur avec le mot de passe actuel qu'il a saisi
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) {
      setError("Le mot de passe actuel est incorrect.");
      setLoading(false);
      return;
    }

    // 3. Si le mot de passe actuel est bon, on met à jour !
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (updateError) {
      setError("Erreur lors de la mise à jour : " + updateError.message);
    } else {
      setMessage("Votre mot de passe a été modifié avec succès !");
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // Optionnel : Rediriger vers le tableau de bord après 3 secondes
      setTimeout(() => {
        navigate('/');
      }, 3000);
    }

    setLoading(false);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 bg-slate-50 overflow-hidden">

      {/* BACKGROUND ANIMATED BLOBS */}
      <div className="absolute top-[-5%] left-[-5%] w-[500px] h-[500px] bg-indigo-200 rounded-full mix-blend-multiply filter blur-[70px] opacity-70 animate-blob"></div>
      <div className="absolute top-[15%] right-[-5%] w-[450px] h-[450px] bg-purple-200 rounded-full mix-blend-multiply filter blur-[70px] opacity-70 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-10%] left-[10%] w-[500px] h-[500px] bg-blue-200 rounded-full mix-blend-multiply filter blur-[70px] opacity-70 animate-blob animation-delay-4000"></div>

      {/* CARTE GLASS */}
      <div className="relative w-full max-w-[450px] bg-white/70 backdrop-blur-2xl p-10 rounded-[2.5rem] border border-white/50 shadow-[0_20px_50px_rgba(0,0,0,0.08)] z-10">

        {/* En-tête */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-white/80 flex items-center justify-center rounded-2xl mb-4 shadow-sm border border-slate-100">
            <ShieldCheck className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight text-center">Sécurité du compte</h1>
          <p className="text-slate-500 text-sm mt-3 text-center leading-relaxed">
            Veuillez saisir votre mot de passe actuel pour en définir un nouveau.
          </p>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm text-center">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-6 px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 text-sm text-center font-medium">
            {message}
          </div>
        )}

        {/* Formulaire */}
        <form className="space-y-4" onSubmit={handleChangePassword}>

          {/* Mot de passe actuel */}
          <div className="relative">
            <KeyRound className="absolute left-5 top-4 w-5 h-5 text-slate-400" />
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white border border-slate-200 text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:text-slate-400"
              placeholder="Mot de passe actuel"
              required
              disabled={loading || message !== ''}
            />
          </div>

          <div className="h-px w-full bg-slate-200 my-2"></div>

          {/* Nouveau mot de passe */}
          <div className="relative">
            <Lock className="absolute left-5 top-4 w-5 h-5 text-slate-400" />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white border border-slate-200 text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:text-slate-400"
              placeholder="Nouveau mot de passe"
              required
              disabled={loading || message !== ''}
            />
          </div>

          {/* Confirmer Nouveau mot de passe */}
          <div className="relative">
            <Lock className="absolute left-5 top-4 w-5 h-5 text-slate-400" />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white border border-slate-200 text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:text-slate-400"
              placeholder="Confirmer le nouveau mot de passe"
              required
              disabled={loading || message !== ''}
            />
          </div>

          <button
            type="submit"
            disabled={loading || message !== ''}
            className="w-full py-4 mt-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/20 disabled:opacity-50 flex justify-center items-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Mettre à jour'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-slate-500 hover:text-indigo-600 transition-colors"
          >
            Retour au tableau de bord
          </button>
        </div>

      </div>
    </div>
  );
}