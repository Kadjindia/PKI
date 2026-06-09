import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Mail, KeyRound, Loader2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    // --- VÉRIFICATION DU DOMAINE ---
    const domaineAutorise = "@gmail.com";

    if (!email.toLowerCase().endsWith(domaineAutorise)) {
      setError(`Seules les adresses ${domaineAutorise} sont autorisées.`);
      return;
    }

    setLoading(true);

    // Appel à Supabase pour envoyer l'email de réinitialisation
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError("Erreur : " + resetError.message);
    } else {
      setMessage("Si ce compte existe, un email contenant les instructions a été envoyé.");
      setEmail(''); // On vide le champ
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
      <div className="relative w-full max-w-[420px] bg-white/70 backdrop-blur-2xl p-10 rounded-[2.5rem] border border-white/50 shadow-[0_20px_50px_rgba(0,0,0,0.08)] z-10">

        {/* En-tête */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-white/80 flex items-center justify-center rounded-2xl mb-4 shadow-sm border border-slate-100">
            <KeyRound className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight text-center">Mot de passe oublié</h1>
          <p className="text-slate-500 text-sm mt-3 text-center leading-relaxed">
            Entrez votre adresse e-mail pour recevoir un lien de réinitialisation.
          </p>
        </div>

        {/* Messages d'erreur ou de succès */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm text-center">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-6 px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 text-sm text-center">
            {message}
          </div>
        )}

        {/* Formulaire */}
        <form className="space-y-5" onSubmit={handleResetRequest}>
          <div className="relative">
            <Mail className="absolute left-5 top-4 w-5 h-5 text-slate-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-14 pr-6 py-4 rounded-2xl bg-white border border-slate-200 text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:text-slate-400"
              placeholder="Votre e-mail"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/20 disabled:opacity-50 flex justify-center items-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Envoyer le lien'}
          </button>

          <div className="flex justify-center mt-6 pt-2">
            <Link
              to="/login"
              className="group flex items-center text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
              Retour à la connexion
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}