import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { FaEnvelope } from 'react-icons/fa';

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
    <div className="login-container">
      <div className="login-card">
        <h1 className="login-title">Mot de passe oublié</h1>
        <p className="text-gray-400 text-sm mb-6 text-center">
          Entrez votre adresse e-mail pour recevoir un lien de réinitialisation.
        </p>

        {error && <div className="error-message" style={{color: '#ef4444', marginBottom: '1rem'}}>{error}</div>}
        {message && <div className="success-message" style={{color: '#22c55e', marginBottom: '1rem'}}>{message}</div>}

        <form className="login-form" onSubmit={handleResetRequest}>
          <div className="form-group">
            <FaEnvelope className="input-icon" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 p-2 w-full rounded-full bg-gray-800 text-gray-200 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Votre e-mail"
              required
            />
          </div>

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'Envoi en cours...' : 'Envoyer le lien'}
          </button>

          <div className="flex justify-center w-full mt-6">
            <Link
              to="/login"
              className="text-sm text-indigo-400 hover:text-indigo-300 hover:underline"
            >
              Retour à la connexion
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}