'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, EyeOff, IdCard, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErroPortal, loginFiliado } from '@/lib/portal-filiado';
import { ROTA_INICIO, ROTA_SENHA, usePortalFiliado } from '@/components/portal-filiado/portal-guard';
import { V } from '@/lib/vocabulario';

export default function EntrarNoPortalPage() {
  const router = useRouter();
  const { atualizar } = usePortalFiliado();
  const [identificacao, setIdentificacao] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!identificacao.trim()) {
      toast.error('Informe seu CPF ou sua matrícula.');
      return;
    }
    if (!senha) {
      toast.error('Informe a senha.');
      return;
    }

    setEntrando(true);
    try {
      const filiado = await loginFiliado(identificacao, senha);
      atualizar(filiado);
      const primeiroNome = filiado.nomeCompleto.trim().split(/\s+/)[0];
      toast.success(`Bem-vindo(a), ${primeiroNome}.`);
      router.replace(filiado.primeiroAcesso ? ROTA_SENHA : ROTA_INICIO);
    } catch (err) {
      const e = err as ErroPortal;
      /*
        429 é o limite de tentativas do servidor, e vale explicar: sem isso a
        pessoa repete a senha CERTA achando que errou, e liga para a secretaria.
      */
      toast.error(
        e.status === 429
          ? 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
          : e.message || 'Não foi possível entrar.',
      );
    } finally {
      setEntrando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo orientation="horizontal" variant="auto" className="mx-auto h-10" />
          <p className="mt-4 flex items-center justify-center gap-1.5 text-sm font-semibold">
            <IdCard className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            Portal do {V.Filiado}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sua carteirinha, seus processos e seu cadastro.
          </p>
        </div>

        <form onSubmit={entrar} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-1.5">
            <label htmlFor="identificacao" className="text-sm font-medium">
              CPF ou matrícula
            </label>
            <Input
              id="identificacao"
              autoFocus
              autoComplete="username"
              placeholder="000.000.000-00 ou sua matrícula"
              value={identificacao}
              onChange={(e) => setIdentificacao(e.target.value)}
            />
            {/*
              A DICA DA MATRÍCULA NÃO É DECORAÇÃO. Medido: só 39% dos ativos têm
              CPF no cadastro. Quem não tem tentaria o CPF, levaria "inválidos" e
              concluiria que não tem acesso — quando tem, pela matrícula, que
              está impressa na carteirinha dele.
            */}
            <p className="text-[11px] leading-snug text-muted-foreground">
              A matrícula está na sua carteirinha. Se o sindicato ainda não tem seu CPF, entre
              por ela.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="senha" className="text-sm font-medium">
              Senha
            </label>
            <div className="relative">
              <Input
                id="senha"
                type={verSenha ? 'text' : 'password'}
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setVerSenha((v) => !v)}
                aria-label={verSenha ? 'Ocultar a senha' : 'Mostrar a senha'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
              >
                {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" disabled={entrando} className="w-full">
            {entrando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Entrando…
              </>
            ) : (
              <>
                <LogIn className="mr-2 h-4 w-4" /> Entrar
              </>
            )}
          </Button>

          {/*
            NÃO HÁ "ESQUECI MINHA SENHA" — e é honesto não ter. O sistema não
            envia e-mail nem SMS (medido: 5% dos ativos têm e-mail cadastrado),
            então um link de recuperação levaria a maioria a um beco. Quem gera
            a senha é a secretaria, e é para ela que a pessoa deve ligar.
          */}
          <p className="flex items-start gap-1.5 border-t pt-4 text-[11px] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Esqueceu a senha ou ainda não tem acesso? Procure a secretaria do sindicato — ela gera
            uma senha nova na hora.
          </p>
        </form>
      </div>
    </main>
  );
}
