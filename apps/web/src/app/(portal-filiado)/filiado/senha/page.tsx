'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErroPortal, trocarSenha } from '@/lib/portal-filiado';
import { ROTA_INICIO, usePortalFiliado } from '@/components/portal-filiado/portal-guard';

const MINIMO = 6;

/**
 * A TROCA DA SENHA PROVISÓRIA.
 *
 * É obrigatória, e a obrigação mora no SERVIDOR: o guard da API recusa todas as
 * outras rotas do portal enquanto a senha for a provisória. Esta tela é o
 * caminho, não a trava.
 */
export default function TrocarSenhaPage() {
  const router = useRouter();
  const { filiado, atualizar } = usePortalFiliado();
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [vendo, setVendo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const curta = nova.length > 0 && nova.length < MINIMO;
  const divergem = confirmacao.length > 0 && nova !== confirmacao;
  const podeSalvar = nova.length >= MINIMO && nova === confirmacao && !salvando;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!podeSalvar) return;

    setSalvando(true);
    try {
      const atualizado = await trocarSenha(nova);
      atualizar(atualizado);
      toast.success('Senha definida. Bem-vindo(a) ao portal.');
      router.replace(ROTA_INICIO);
    } catch (err) {
      toast.error((err as ErroPortal).message || 'Não foi possível trocar a senha.');
    } finally {
      setSalvando(false);
    }
  }

  const primeiroNome = filiado?.nomeCompleto.trim().split(/\s+/)[0];

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo orientation="horizontal" variant="auto" className="mx-auto h-10" />
          <p className="mt-4 flex items-center justify-center gap-1.5 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            {primeiroNome ? `Olá, ${primeiroNome}` : 'Crie sua senha'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Antes de entrar, escolha uma senha só sua. A que a secretaria passou não vale mais
            depois disto.
          </p>
        </div>

        <form onSubmit={salvar} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-1.5">
            <label htmlFor="nova" className="text-sm font-medium">
              Nova senha
            </label>
            <div className="relative">
              <Input
                id="nova"
                autoFocus
                type={vendo ? 'text' : 'password'}
                autoComplete="new-password"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setVendo((v) => !v)}
                aria-label={vendo ? 'Ocultar a senha' : 'Mostrar a senha'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
              >
                {vendo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {/*
              A EXIGÊNCIA É SÓ O TAMANHO. Pedir maiúscula, número e símbolo num
              portal usado do celular, no corredor do hospital, produz senha
              anotada no verso da carteirinha — pior do que uma senha curta.
            */}
            <p className={`text-[11px] ${curta ? 'text-red-600' : 'text-muted-foreground'}`}>
              Pelo menos {MINIMO} caracteres. Use algo que você lembre.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmacao" className="text-sm font-medium">
              Repita a senha
            </label>
            <Input
              id="confirmacao"
              type={vendo ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
            {divergem && <p className="text-[11px] text-red-600">As duas senhas não são iguais.</p>}
          </div>

          <Button type="submit" disabled={!podeSalvar} className="w-full">
            {salvando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…
              </>
            ) : (
              'Salvar e entrar'
            )}
          </Button>

          <p className="flex items-start gap-1.5 border-t pt-4 text-[11px] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Ninguém do sindicato consegue ver esta senha — nem o administrador. Se você esquecer,
            a secretaria gera uma nova.
          </p>
        </form>
      </div>
    </main>
  );
}
