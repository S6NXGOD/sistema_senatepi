import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Interceptador de rotas — GUEST ROUTES.
//
// A sessão é persistida no cliente em localStorage + cookie (ver lib/api.ts).
// Como o middleware roda no servidor, ele lê o TOKEN pelos COOKIES:
//   - senatepi.refreshToken (credencial durável — preferida)
//   - senatepi.accessToken  (fallback)
//
// Regra: usuário LOGADO que tenta abrir a tela de visitante (/login ou a raiz
// "/") é redirecionado para o painel (/dashboard). Funciona em navegação direta
// (digitar a URL / recarregar), que é justamente o cenário do problema.
//
// A PROTEÇÃO de rotas privadas permanece no cliente (DashboardShell). Fazê-la
// aqui dependia de o cookie estar visível no servidor durante a navegação SPA
// logo após o login — o que não é garantido e causava um "bounce" de volta ao
// /login (login aparentemente sem efeito). Mantendo só o guest redirect, não há
// como o /dashboard ser rejeitado por engano.
// ---------------------------------------------------------------------------

const ACCESS_COOKIE = 'senatepi.accessToken';
const REFRESH_COOKIE = 'senatepi.refreshToken';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token =
    request.cookies.get(REFRESH_COOKIE)?.value || request.cookies.get(ACCESS_COOKIE)?.value;
  const logado = Boolean(token);

  // GUEST ROUTE: logado tentando abrir /login (ou "/") → painel.
  if (logado && (pathname === '/login' || pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Executa apenas nas rotas de visitante — não interfere no restante da app.
  matcher: ['/', '/login'],
};
