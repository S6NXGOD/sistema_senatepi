import axios, { AxiosError } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';

export const api = axios.create({ baseURL: API_URL });

const ACCESS_KEY = 'senatepi.accessToken';
const REFRESH_KEY = 'senatepi.refreshToken';

export const tokenStore = {
  get access() {
    return typeof window !== 'undefined' ? localStorage.getItem(ACCESS_KEY) : null;
  },
  get refresh() {
    return typeof window !== 'undefined' ? localStorage.getItem(REFRESH_KEY) : null;
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
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
