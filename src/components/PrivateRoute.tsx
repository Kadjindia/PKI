import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface PrivateRouteProps {
  children: React.ReactNode;
}

const PrivateRoute = ({ children }: PrivateRouteProps) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Chargement...</div>;
  }

  // Si l'utilisateur est présent, on affiche les enfants (la page demandée), sinon on redirige
  return user ? <>{children}</> : <Navigate to="/login" replace />;
};

export default PrivateRoute;