/**
 * ProtectedRoute — Phase 2
 * 
 * Wraps pages that require authentication in a Layout + auth guard.
 * Eliminates ~20 duplicated inline auth checks in App.tsx.
 */

import { FC, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import Layout from './Layout';

interface ProtectedRouteProps {
  children: ReactNode;
  /** Required roles. If empty, any authenticated user is allowed. */
  roles?: string[];
  /** If true, don't wrap in Layout (for admin pages that have their own layout) */
  noLayout?: boolean;
}

const ProtectedRoute: FC<ProtectedRouteProps> = ({ children, roles, noLayout }) => {
  const { user } = useAuthStore();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (noLayout) {
    return <>{children}</>;
  }

  return <Layout>{children}</Layout>;
};

export default ProtectedRoute;
