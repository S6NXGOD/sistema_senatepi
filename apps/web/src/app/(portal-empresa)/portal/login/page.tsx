'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Building2, Eye, EyeOff, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  loginEmpresa, mascaraCnpj, apenasDigitos, ErroPortal,
} from '@/lib/portal-empresa';
import {
  usePortalEmpresa, ROTA_INICIO, ROTA_PRIMEIRO_ACESSO,
} from '@/components/portal-empresa/portal-guard';

export default function LoginEmpresaPage() {
  const router = useRouter();
  const { atualizar } = usePortalEmpresa();
  const [cnpj, setCnpj] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (apenasDigitos(cnpj).length !== 14) {
      toast.error('Informe o CNPJ completo, com 14 dígitos.');
      return;
    }
    if (!senha) {
      toast.error('Informe a senha.');
      return;
    }

    setEntrando(true);
    try {
      const empresa = await loginEmpresa(cnpj, senha);
      atualizar(empresa);
      toast.success(`Bem-vindo(a), ${empresa.nomeFantasia || empresa.razaoSocial}.`);
      router.replace(empresa.primeiroAcesso ? ROTA_PRIMEIRO_ACESSO : ROTA_INICIO);
    } catch (err) {
      const e = err as ErroPortal;
      // 429 = limite de tentativas do servidor; vale explicar, senão a pessoa
      // fica repetindo a senha certa achando que errou.
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
            <Building2 className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            Portal da Empresa
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Acesso exclusivo das empresas conveniadas.
          </p>
        </div>

        <form
          onSubmit={entrar}
          className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
        >
          <div className="space-y-1.5">
            <label htmlFor="cnpj" className="text-sm font-medium">CNPJ</label>
            <Input
              id="cnpj"
              autoFocus
              inputMode="numeric"
              autoComplete="username"
              placeholder="00.000.000/0000-00"
              value={cnpj}
              onChange={(e) => setCnpj(mascaraCnpj(e.target.value))}
              className="h-12 text-base md:h-11"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="senha" className="text-sm font-medium">Senha</label>
            <div className="relative">
              <Input
                id="senha"
                type={verSenha ? 'text' : 'password'}
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="h-12 pr-10 text-base md:h-11"
              />
              <button
                type="button"
                onClick={() => setVerSenha((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="h-12 w-full md:h-11" disabled={entrando}>
            {entrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Entrar
          </Button>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No primeiro acesso, use a senha provisória entregue pelo sindicato — ela terá de ser
            trocada antes de usar o portal.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Esqueceu a senha? Fale com a secretaria do SENATEPI.
        </p>
      </div>
    </main>
  );
}
