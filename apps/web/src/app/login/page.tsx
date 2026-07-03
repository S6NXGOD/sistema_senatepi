'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Loader2, Lock, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/logo';
import { InstallHint } from '@/components/install-hint';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  senha: z.string().min(6, 'Mínimo de 6 caracteres'),
  lembrar: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { login, user, carregando } = useAuth();
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { lembrar: true } });

  // Guest route (fallback client-side): sessão restaurada do storage já loga →
  // manda para o painel. O middleware cobre o caso via cookie no servidor.
  useEffect(() => {
    if (!carregando && user) router.replace('/dashboard');
  }, [carregando, user, router]);

  async function onSubmit(data: FormData) {
    setEnviando(true);
    try {
      await login(data.email, data.senha, data.lembrar);
      toast.success('Bem-vindo(a) ao SENATEPI');
    } catch {
      toast.error('Credenciais inválidas');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Lateral institucional */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-gradient-to-br from-senatepi-900 via-senatepi-800 to-senatepi-600 p-12 text-white lg:flex">
        <Logo orientation="horizontal" variant="branco" className="h-14" />
        <div className="space-y-4">
          <h1 className="text-4xl font-bold leading-tight">
            Gestão sindical moderna e segura
          </h1>
          <p className="max-w-md text-white/80">
            Filiação, recadastramento, carteirinha digital, eventos e controle de acesso
            por QR Code — tudo em uma plataforma profissional.
          </p>
        </div>
        <p className="text-sm text-white/60">
          © {new Date().getFullYear()} SENATEPI — Sindicato dos Enfermeiros do Piauí
        </p>
      </div>

      {/* Formulário */}
      <div className="flex w-full items-center justify-center bg-cinza-claro p-6 dark:bg-background lg:w-1/2">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md space-y-8"
        >
          <div className="lg:hidden">
            <Logo orientation="horizontal" variant="auto" className="h-12" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Acessar o sistema</h2>
            <p className="text-sm text-muted-foreground">
              Entre com suas credenciais para continuar
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  className="pl-10"
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  {...register('senha')}
                />
              </div>
              {errors.senha && (
                <p className="text-xs text-red-500">{errors.senha.message}</p>
              )}
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-senatepi-800" {...register('lembrar')} />
                Lembrar acesso
              </label>
              <a href="/recuperar-senha" className="text-senatepi-800 hover:underline dark:text-senatepi-400">
                Esqueci minha senha
              </a>
            </div>

            <Button type="submit" className="h-12 w-full text-base" disabled={enviando}>
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              Entrar
            </Button>
          </form>

          {/* Instalação do app administrativo (condicional por dispositivo) */}
          <InstallHint />
        </motion.div>
      </div>
    </div>
  );
}
