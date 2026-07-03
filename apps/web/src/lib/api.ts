import axios, { AxiosError } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';

export const api = axios.create({ baseURL: API_URL });

const ACCESS_KEY = 'senatepi.accessToken';
const REFRESH_KEY = 'senatepi.refreshToken';

// ---------------------------------------------------------------------------
// Persistência resiliente: localStorage + cookie de longa duração (fallback).
// Em PWAs instalados o localStorage pode ser particionado/limpo pelo sistema;
// o cookie persistente mantém a sessão viva ("login persistente") e reidrata o
// localStorage quando disponível. NUNCA usar sessionStorage/memória volátil.
// ---------------------------------------------------------------------------
const COOKIE_DIAS = 180;

function setCookie(nome: string, valor: string) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + COOKIE_DIAS * 864e5).toUTCString();
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${nome}=${encodeURIComponent(valor)}; Expires=${exp}; Path=/; SameSite=Lax${secure}`;
}

function getCookie(nome: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + nome.replace(/\./g, '\\.') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function delCookie(nome: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${nome}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax`;
}

function salvar(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* storage indisponível — segue apenas com cookie */
  }
  setCookie(chave, valor);
}

function ler(chave: string): string | null {
  try {
    const v = localStorage.getItem(chave);
    if (v) return v;
  } catch {
    /* ignore */
  }
  const c = getCookie(chave);
  if (c) {
    // Reidrata o localStorage a partir do cookie quando possível.
    try {
      localStorage.setItem(chave, c);
    } catch {
      /* ignore */
    }
    return c;
  }
  return null;
}

function remover(chave: string) {
  try {
    localStorage.removeItem(chave);
  } catch {
    /* ignore */
  }
  delCookie(chave);
}

/** Storage persistente (localStorage + cookie fallback) para dados de sessão. */
export const persistentStore = {
  get: (chave: string) => (typeof window !== 'undefined' ? ler(chave) : null),
  set: (chave: string, valor: string) => salvar(chave, valor),
  remove: (chave: string) => remover(chave),
};

export const tokenStore = {
  get access() {
    return typeof window !== 'undefined' ? ler(ACCESS_KEY) : null;
  },
  get refresh() {
    return typeof window !== 'undefined' ? ler(REFRESH_KEY) : null;
  },
  set(access: string, refresh: string) {
    salvar(ACCESS_KEY, access);
    salvar(REFRESH_KEY, refresh);
  },
  clear() {
    remover(ACCESS_KEY);
    remover(REFRESH_KEY);
  },
};

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Renova o access token automaticamente quando expira (401).
let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean };
    if (error.response?.status === 401 && original && !original._retry && tokenStore.refresh) {
      original._retry = true;
      refreshing ??= api
        .post('/auth/refresh', { refreshToken: tokenStore.refresh })
        .then((r) => {
          tokenStore.set(r.data.accessToken, r.data.refreshToken);
          return r.data.accessToken as string;
        })
        .catch((err: AxiosError) => {
          // Só encerra a sessão se o refresh token for realmente inválido/expirado.
          // Erros transitórios (rede/servidor) NÃO deslogam — mantém o login persistente.
          const status = err.response?.status;
          if (status === 401 || status === 403) {
            tokenStore.clear();
            if (typeof window !== 'undefined') window.location.href = '/login';
          }
          return null;
        })
        .finally(() => {
          refreshing = null;
        });

      const novoToken = await refreshing;
      if (novoToken && original.headers) {
        original.headers.Authorization = `Bearer ${novoToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);
