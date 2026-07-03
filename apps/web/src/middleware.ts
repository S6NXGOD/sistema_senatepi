import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Interceptador de rotas (Guest Routes + proteção de rotas privadas).
//
// A sessão é persistida no cliente em localStorage + cookie (ver lib/api.ts).
// Como o middleware roda no servidor, ele lê o TOKEN pelos COOKIES:
//   - senatepi.refreshToken (credencial durável — preferida)
//   - senatepi.accessToken  (fallback)
// ---------------------------------------------------------------------------

const ACCESS_COOKIE = 'senatepi.accessToken';
const REFRESH_COOKIE = 'senatepi.refreshToken';

// Rotas de VISITANTE (acessíveis sem sessão). Todo o resto é privado (painel).
const ROTAS_PUBLICAS = new Set(['/login', '/recuperar-senha']);
const PREFIXOS_PUBLICOS = ['/colonia']; // portal público da Colônia de Férias

function ehPublica(pathname: string): boolean {
  if (ROTAS_PUBLICAS.has(pathname)) return true;
  return PREFIXOS_PUBLICOS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Token de sessão a partir do cookie (refresh preferido; access como fallback).
  const token =
    request.cookies.get(REFRESH_COOKIE)?.value || request.cookies.get(ACCESS_COOKIE)?.value;
  const logado = Boolean(token);

  // Rota de visitante que um usuário logado NÃO deve ver (login e raiz).
  const rotaVisitante = pathname === '/login' || pathname === '/';

  // 1) GUEST ROUTE: logado tentando abrir /login (ou "/") → vai para o painel.
  if (logado && rotaVisitante) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // 2) PROTEÇÃO PADRÃO: deslogado tentando abrir rota privada → vai para o login.
  //    A raiz "/" já tem seu próprio redirect no servidor e fica de fora daqui,
  //    evitando redirecionamentos duplicados/loops.
  if (!logado && pathname !== '/' && !ehPublica(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Ignora assets estáticos, imagens do Next, manifest/ícones e arquivos com extensão.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\..*).*)'],
};
