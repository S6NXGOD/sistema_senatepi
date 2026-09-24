'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  buscarSessao,
  encerrarSessao,
  lerFiliado,
  lerToken,
  type FiliadoSessao,
} from '@/lib/portal-filiado';

export const ROTA_LOGIN = '/filiado/entrar';
export const ROTA_SENHA = '/filiado/senha';
export const ROTA_INICIO = '/filiado';

interface Sessao {
  filiado: FiliadoSessao | null;
  atualizar: (f: FiliadoSessao) => void;
  sair: () => void;
}

const Ctx = createContext<Sessao | null>(null);

export function usePortalFiliado(): Sessao {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePortalFiliado exige o PortalGuard');
  return ctx;
}

/**
 * Proteção do Portal do Filiado.
 *
 * Três decisões, nesta ordem:
 *  1) sem token → manda para o login;
 *  2) com `primeiroAcesso` → PRENDE na troca de senha (nenhuma outra rota abre);
 *  3) já trocou → não deixa voltar para login/troca.
 *
 * A verificação é feita CONTRA O SERVIDOR (`/auth/eu`), nunca contra o
 * localStorage: o que está no navegador é dica de interface, e quem editasse a
 * chave à mão só veria uma casca vazia — cada requisição do portal é barrada
 * pelo guard da API enquanto a senha for a provisória.
 *
 * Mesmo desenho do portal patronal, de propósito.
 */
export function PortalGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [filiado, setFiliado] = useState<FiliadoSessao | null>(() => lerFiliado());
  const [verificando, setVerificando] = useState(true);

  const ehPublica = pathname === ROTA_LOGIN;

  useEffect(() => {
    let ativo = true;

    async function verificar() {
      const token = lerToken();

      if (!token) {
        if (ativo) {
          setFiliado(null);
          setVerificando(false);
        }
        if (!ehPublica) router.replace(ROTA_LOGIN);
        return;
      }

      try {
        const atual = await buscarSessao();
        if (!ativo) return;
        setFiliado(atual);
        setVerificando(false);

        if (atual.primeiroAcesso && pathname !== ROTA_SENHA) {
          router.replace(ROTA_SENHA);
        } else if (!atual.primeiroAcesso && ehPublica) {
          router.replace(ROTA_INICIO);
        }
      } catch {
        // Expirado, revogado ou desfiliado: limpa e volta ao login.
        encerrarSessao();
        if (!ativo) return;
        setFiliado(null);
        setVerificando(false);
        if (!ehPublica) router.replace(ROTA_LOGIN);
      }
    }

    void verificar();
    return () => {
      ativo = false;
    };
  }, [pathname, ehPublica, router]);

  const valor: Sessao = {
    filiado,
    atualizar: setFiliado,
    sair: () => {
      encerrarSessao();
      setFiliado(null);
      router.replace(ROTA_LOGIN);
    },
  };

  /*
    Enquanto verifica, nada de conteúdo protegido na tela — evita o "flash" do
    portal para quem já não tem sessão. A rota da troca de senha NÃO é bloqueada
    quando `primeiroAcesso`: é justamente para onde a pessoa está indo.
  */
  const bloqueado =
    verificando && !ehPublica ? true : !!filiado?.primeiroAcesso && pathname !== ROTA_SENHA;

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
