import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { setAccessToken, setSessionExpiredHandler } from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(clearSession);
  }, [clearSession]);

  // On first load: check whether an admin account exists yet, then try a
  // silent refresh (relies on the httpOnly cookie) so a page reload doesn't
  // force the user to log in again even though the in-memory access token
  // was lost.
  useEffect(() => {
    (async () => {
      try {
        const { data: statusData } = await api.get('/auth/setup-status');
        if (statusData.needsSetup) {
          setNeedsSetup(true);
          return;
        }
        const { data } = await api.post('/auth/refresh');
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        clearSession();
      } finally {
        setInitializing(false);
      }
    })();
  }, [clearSession]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const setupAdmin = useCallback(async (name, email, password) => {
    const { data } = await api.post('/auth/setup', { name, email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    setNeedsSetup(false);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshMe = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, initializing, needsSetup, login, logout, setupAdmin, refreshMe, isAuthenticated: !!user }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>');
  return ctx;
}
