'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from './api';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: 'ADMIN' | 'DIRETORIA' | 'FUNCIONARIO' | 'RECEPCAO';
}

interface AuthContextValue {
  user: Usuario | null;
  carregando: boolean;
  login: (email: string, senha: string, lembrar?: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_KEY = 'senatepi.user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const armazenado = typeof window !== 'undefined' ? localStorage.getItem(USER_KEY) : null;
    if (armazenado && tokenStore.access) setUser(JSON.parse(armazenado));
    setCarregando(false);
  }, []);

  async function login(email: string, senha: string, lembrar = false) {
    const { data } = await api.post('/auth/login', { email, senha, lembrar });
    tokenStore.set(data.accessToken, data.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setUser(data.user);
    router.push('/dashboard');
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignora */
    }
    tokenStore.clear();
    localStorage.removeItem(USER_KEY);
    setUser(null);
    router.push('/login');
  }

  return (
    <AuthContext.Provider value={{ user, carregando, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
