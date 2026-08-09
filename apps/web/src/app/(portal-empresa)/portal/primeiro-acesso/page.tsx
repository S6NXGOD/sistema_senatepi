'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { definirSenhaDefinitiva, ErroPortal } from '@/lib/portal-empresa';
import { usePortalEmpresa, ROTA_INICIO } from '@/components/portal-empresa/portal-guard';

const MINIMO = 8;

/**
 * Troca obrigatória da senha provisória.
 *
 * Não há como sair daqui a não ser trocando a senha (ou saindo da sessão): o
 * guard devolve para cá qualquer outra rota do portal, e a API recusa todas
 * enquanto `primeiroAcesso` for verdadeiro.
 */
export default function PrimeiroAcessoPage() {
  const router = useRouter();
  const { empresa, atualizar, sair } = usePortalEmpresa();
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [ver, setVer] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const curta = nova.length > 0 && nova.length < MINIMO;
  const divergem = confirmacao.length > 0 && nova !== confirmacao;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (nova.length < MINIMO) return toast.error(`A nova senha precisa de ao menos ${MINIMO} caracteres.`);
    if (nova !== confirmacao) return toast.error('A confirmação não confere com a nova senha.');

    setSalvando(true);
    try {
      const atualizada = await definirSenhaDefinitiva(nova);
      atualizar(atualizada);
      toast.success('Senha definida. Bem-vindo(a) ao portal!');
      router.replace(ROTA_INICIO);
    } catch (err) {
      const e = err as ErroPortal;
      toast.error(e.message || 'Não foi possível definir a senha.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo orientation="horizontal" variant="auto" className="mx-auto h-10" />
          <div className="mx-auto mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/30">
            <KeyRound className="h-6 w-6 text-brand-800 dark:text-brand-400" />
          </div>
          <h1 className="mt-3 text-lg font-bold">Crie sua senha de acesso</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {empresa?.nomeFantasia || empresa?.razaoSocial}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            A senha provisória serve só para esta primeira entrada. Defina uma senha sua para
            continuar.
          </p>
        </div>

        <form onSubmit={salvar} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-1.5">
            <label htmlFor="nova" className="text-sm font-medium">Nova senha</label>
            <div className="relative">
              <Input
                id="nova"
                autoFocus
                type={ver ? 'text' : 'password'}
                autoComplete="new-password"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                className="h-12 pr-10 text-base md:h-11"
              />
              <button
                type="button"
                onClick={() => setVer((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={ver ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className={`text-xs ${curta ? 'text-destructive' : 'text-muted-foreground'}`}>
              Mínimo de {MINIMO} caracteres, diferente da senha provisória.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmacao" className="text-sm font-medium">Repita a nova senha</label>
            <Input
              id="confirmacao"
              type={ver ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              className="h-12 text-base md:h-11"
            />
            {divergem && <p className="text-xs text-destructive">As senhas não são iguais.</p>}
          </div>

          <Button
            type="submit"
            className="h-12 w-full md:h-11"
            disabled={salvando || nova.length < MINIMO || nova !== confirmacao}
          >
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Salvar e entrar
          </Button>
        </form>

        <button
          type="button"
          onClick={sair}
          className="mx-auto mt-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" /> Sair e voltar ao login
        </button>
      </div>
    </main>
  );
}
