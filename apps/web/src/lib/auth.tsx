'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore, persistentStore } from './api';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: 'ADMIN' | 'DIRETORIA' | 'FUNCIONARIO' | 'RECEPCAO';
  username?: string | null;
  avatarUrl?: string | null;
}

interface AuthContextValue {
  user: Usuario | null;
  carregando: boolean;
  login: (email: string, senha: string, lembrar?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  /** Atualiza o usuário no contexto + storage (ex.: após salvar o perfil). */
  atualizarUsuario: (parcial: Partial<Usuario>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_KEY = 'senatepi.user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const armazenado = persistentStore.get(USER_KEY);
    // Restaura a sessão enquanto houver refresh token (credencial DURÁVEL). O
    // access token expirado/ausente é renovado silenciosamente pelo interceptor
    // do Axios no primeiro request — sem deslogar ao reabrir o PWA/navegador.
    if (armazenado && (tokenStore.refresh || tokenStore.access)) {
      try {
        setUser(JSON.parse(armazenado));
      } catch {
        /* dado corrompido — ignora */
      }
    }
    setCarregando(false);
  }, []);

  async function login(email: string, senha: string, lembrar = false) {
    const { data } = await api.post('/auth/login', { email, senha, lembrar });
    tokenStore.set(data.accessToken, data.refreshToken);
    persistentStore.set(USER_KEY, JSON.stringify(data.user));
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
    persistentStore.remove(USER_KEY);
    setUser(null);
    router.push('/login');
  }

  function atualizarUsuario(parcial: Partial<Usuario>) {
    setUser((atual) => {
      if (!atual) return atual;
      const novo = { ...atual, ...parcial };
      persistentStore.set(USER_KEY, JSON.stringify(novo));
      return novo;
    });
  }

  return (
    <AuthContext.Provider value={{ user, carregando, login, logout, atualizarUsuario }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
