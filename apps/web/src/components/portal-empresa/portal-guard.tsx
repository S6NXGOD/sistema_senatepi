'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  buscarSessao, encerrarSessao, lerEmpresa, lerToken, type EmpresaSessao,
} from '@/lib/portal-empresa';

export const ROTA_LOGIN = '/portal/login';
export const ROTA_PRIMEIRO_ACESSO = '/portal/primeiro-acesso';
export const ROTA_INICIO = '/portal';

interface Sessao {
  empresa: EmpresaSessao | null;
  atualizar: (e: EmpresaSessao) => void;
  sair: () => void;
}

const Ctx = createContext<Sessao | null>(null);

export function usePortalEmpresa(): Sessao {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePortalEmpresa exige o PortalGuard');
  return ctx;
}

/**
 * Proteção do Portal da Empresa.
 *
 * Três decisões, nesta ordem:
 *  1) sem token → manda para o login;
 *  2) com `primeiroAcesso` → PRENDE em /portal/primeiro-acesso (nenhuma outra
 *     rota do portal abre antes da troca);
 *  3) já trocou a senha → não deixa voltar para login/primeiro-acesso.
 *
 * A verificação é feita CONTRA O SERVIDOR (`/auth/eu`), não contra o
 * localStorage: o estado gravado no navegador é dica de interface, e quem
 * editasse a chave à mão só conseguiria ver uma casca vazia — cada requisição
 * do portal é barrada pelo guard da API enquanto a senha for a provisória.
 */
export function PortalGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [empresa, setEmpresa] = useState<EmpresaSessao | null>(() => lerEmpresa());
  const [verificando, setVerificando] = useState(true);

  const ehPublica = pathname === ROTA_LOGIN;

  useEffect(() => {
    let ativo = true;

    async function verificar() {
      const token = lerToken();

      if (!token) {
        if (ativo) {
          setEmpresa(null);
          setVerificando(false);
        }
        if (!ehPublica) router.replace(ROTA_LOGIN);
        return;
      }

      try {
        const atual = await buscarSessao();
        if (!ativo) return;
        setEmpresa(atual);
        setVerificando(false);

        if (atual.primeiroAcesso && pathname !== ROTA_PRIMEIRO_ACESSO) {
          router.replace(ROTA_PRIMEIRO_ACESSO);
        } else if (!atual.primeiroAcesso && (ehPublica || pathname === ROTA_PRIMEIRO_ACESSO)) {
          router.replace(ROTA_INICIO);
        }
      } catch {
        // Token expirado, revogado ou inválido: limpa e volta ao login.
        encerrarSessao();
        if (!ativo) return;
        setEmpresa(null);
        setVerificando(false);
        if (!ehPublica) router.replace(ROTA_LOGIN);
      }
    }

    void verificar();
    return () => { ativo = false; };
  }, [pathname, ehPublica, router]);

  const valor: Sessao = {
    empresa,
    atualizar: setEmpresa,
    sair: () => {
      encerrarSessao();
      setEmpresa(null);
      router.replace(ROTA_LOGIN);
    },
  };

  // Enquanto verifica, nada de conteúdo protegido na tela — evita o "flash"
  // do portal para quem já não tem sessão.
  const bloqueado =
    verificando && !ehPublica
      ? true
      : !!empresa?.primeiroAcesso && pathname !== ROTA_PRIMEIRO_ACESSO;

  return (
    <Ctx.Provider value={valor}>
      {bloqueado ? (
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        children
      )}
    </Ctx.Provider>
  );
}
