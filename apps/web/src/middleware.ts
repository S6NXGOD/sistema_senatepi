import { NextRequest, NextResponse } from 'next/server';
import { tenant } from '@/tenant.config';

// ---------------------------------------------------------------------------
// Interceptador de rotas — GUEST ROUTES.
//
// A sessão é persistida no cliente em localStorage + cookie (ver lib/api.ts).
// Como o middleware roda no servidor, ele lê o TOKEN pelos COOKIES, cujo nome
// leva o id do sindicato: `<cliente>.refreshToken` (durável, preferido) e
// `<cliente>.accessToken` (reserva).
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

const ACCESS_COOKIE = `${tenant.id}.accessToken`;
const REFRESH_COOKIE = `${tenant.id}.refreshToken`;

/**
 * QUEBRA-LAÇO.
 *
 * O cookie prova que uma sessão EXISTIU, não que ela vale. Sempre que o token
 * está presente e a API o recusa, os dois lados brigam: aqui o cookie manda
 * para o painel, e lá o 401 manda de volta para o login. O usuário fica preso
 * sem nunca ver a tela de entrada.
 *
 * Aconteceu de verdade, com duas causas somadas: o cookie de um sindicato
 * chegando ao front de outro, e uma falha de CORS — que, por não ter status
 * HTTP, não era reconhecida como "sessão inválida" e nunca limpava nada.
 *
 * Uma volta é permitida; a segunda, dentro da janela, não. O usuário chega ao
 * login e a sessão morta é descartada lá.
 */
const COOKIE_LACO = `${tenant.id}.bounce`;
const JANELA_LACO_S = 10;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token =
    request.cookies.get(REFRESH_COOKIE)?.value || request.cookies.get(ACCESS_COOKIE)?.value;
  const logado = Boolean(token);
  const jaVoltou = Boolean(request.cookies.get(COOKIE_LACO)?.value);

  // GUEST ROUTE: logado tentando abrir /login (ou "/") → painel.
  if (logado && !jaVoltou && (pathname === '/login' || pathname === '/')) {
    const resposta = NextResponse.redirect(new URL('/dashboard', request.url));
    resposta.cookies.set(COOKIE_LACO, '1', { maxAge: JANELA_LACO_S, path: '/' });
    return resposta;
  }

  // Chegou ao login sem ser mandado de volta: a marca já cumpriu o papel.
  if (jaVoltou && pathname === '/login') {
    const resposta = NextResponse.next();
    resposta.cookies.delete(COOKIE_LACO);
    return resposta;
  }

  return NextResponse.next();
}

export const config = {
  // Executa apenas nas rotas de visitante — não interfere no restante da app.
  matcher: ['/', '/login'],
};
