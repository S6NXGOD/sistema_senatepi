'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { User, ShieldCheck, Loader2, Save, KeyRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import {
  getMeuPerfil,
  atualizarPerfil,
  alterarSenha,
  ROLE_LABEL,
  Perfil,
} from '@/lib/profile';

export default function ConfiguracoesPage() {
  const { data: perfil, isLoading, refetch } = useQuery({
    queryKey: ['perfil-me'],
    queryFn: getMeuPerfil,
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configurações</h2>
        <p className="text-sm text-muted-foreground">Gerencie seus dados de perfil e de acesso.</p>
      </div>

      {isLoading || !perfil ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" />
        </div>
      ) : (
        <Tabs defaultValue="perfil" className="space-y-6">
          <TabsList>
            <TabsTrigger value="perfil"><User className="h-4 w-4" /> Perfil</TabsTrigger>
            <TabsTrigger value="seguranca"><ShieldCheck className="h-4 w-4" /> Segurança</TabsTrigger>
          </TabsList>

          <TabsContent value="perfil">
            <PerfilTab perfil={perfil} onSalvo={() => refetch()} />
          </TabsContent>

          <TabsContent value="seguranca">
            <SegurancaTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Perfil
// ---------------------------------------------------------------------------

const perfilSchema = z.object({
  nome: z.string().min(2, 'Informe o nome de exibição'),
  email: z.string().email('E-mail inválido'),
  username: z
    .string()
    .regex(/^$|^[a-zA-Z0-9_.]{3,40}$/, 'Usuário: 3 a 40 caracteres (letras, números, . ou _)')
    .optional()
    .or(z.literal('')),
  avatarUrl: z.string().url('Informe uma URL válida').optional().or(z.literal('')),
});
type PerfilForm = z.infer<typeof perfilSchema>;

function PerfilTab({ perfil, onSalvo }: { perfil: Perfil; onSalvo: () => void }) {
  const { atualizarUsuario } = useAuth();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PerfilForm>({
    resolver: zodResolver(perfilSchema),
    defaultValues: {
      nome: perfil.nome,
      email: perfil.email,
      username: perfil.username ?? '',
      avatarUrl: perfil.avatarUrl ?? '',
    },
  });

  // Mantém o formulário em sincronia caso o perfil seja recarregado.
  useEffect(() => {
    reset({
      nome: perfil.nome,
      email: perfil.email,
      username: perfil.username ?? '',
      avatarUrl: perfil.avatarUrl ?? '',
    });
  }, [perfil, reset]);

  const avatarUrl = watch('avatarUrl');
  const nome = watch('nome');

  async function onSubmit(d: PerfilForm) {
    try {
      const atualizado = await atualizarPerfil({
        nome: d.nome.trim(),
        email: d.email.trim(),
        username: d.username ?? '',
        avatarUrl: d.avatarUrl ?? '',
      });
      // Reflete no contexto (Topbar) e no storage.
      atualizarUsuario({
        nome: atualizado.nome,
        email: atualizado.email,
        username: atualizado.username,
        avatarUrl: atualizado.avatarUrl,
      });
      toast.success('Perfil atualizado com sucesso.');
      onSalvo();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível atualizar o perfil.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Foto de perfil (URL) + preview */}
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Foto de perfil"
                className="h-16 w-16 shrink-0 rounded-full border object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-senatepi-100 text-xl font-bold text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-300">
                {(nome || perfil.nome).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <label className="text-sm font-medium">Foto de perfil (URL)</label>
              <Input
                type="url"
                placeholder="https://…/foto.jpg"
                className="mt-1"
                {...register('avatarUrl')}
              />
              {errors.avatarUrl && <p className="mt-1 text-xs text-red-500">{errors.avatarUrl.message}</p>}
            </div>
          </div>

          <Campo label="Nome de exibição" erro={errors.nome?.message}>
            <Input {...register('nome')} />
          </Campo>

          <Campo label="E-mail" erro={errors.email?.message}>
            <Input type="email" {...register('email')} />
          </Campo>

          <Campo label="Nome de usuário" erro={errors.username?.message}>
            <Input placeholder="opcional" {...register('username')} />
          </Campo>

          <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Perfil de acesso: <strong>{ROLE_LABEL[perfil.role]}</strong>. Seus dados são tratados conforme
            a LGPD (Lei nº 13.709/2018) — utilizados apenas para a operação do sistema.
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSubmitting ? 'Atualizando…' : 'Salvar alterações'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Segurança (troca de senha)
// ---------------------------------------------------------------------------

const segurancaSchema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe a senha atual'),
    novaSenha: z.string().min(8, 'A nova senha deve ter ao menos 8 caracteres'),
    confirmarNovaSenha: z.string().min(1, 'Confirme a nova senha'),
  })
  .refine((d) => d.novaSenha === d.confirmarNovaSenha, {
    path: ['confirmarNovaSenha'],
    message: 'As senhas não coincidem',
  });
type SegurancaForm = z.infer<typeof segurancaSchema>;

function SegurancaTab() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SegurancaForm>({
    resolver: zodResolver(segurancaSchema),
    defaultValues: { senhaAtual: '', novaSenha: '', confirmarNovaSenha: '' },
  });

  async function onSubmit(d: SegurancaForm) {
    try {
      await alterarSenha(d);
      toast.success('Senha alterada com sucesso.');
      reset({ senhaAtual: '', novaSenha: '', confirmarNovaSenha: '' }); // limpa os campos
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível alterar a senha.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Segurança</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <Campo label="Senha atual" erro={errors.senhaAtual?.message}>
            <Input type="password" autoComplete="current-password" {...register('senhaAtual')} />
          </Campo>

          <Campo label="Nova senha" erro={errors.novaSenha?.message}>
            <Input type="password" autoComplete="new-password" {...register('novaSenha')} />
          </Campo>

          <Campo label="Confirmar nova senha" erro={errors.confirmarNovaSenha?.message}>
            <Input type="password" autoComplete="new-password" {...register('confirmarNovaSenha')} />
          </Campo>

          <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Por segurança, ao alterar a senha as demais sessões são encerradas.
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {isSubmitting ? 'Atualizando…' : 'Alterar senha'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Campo({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {erro && <p className="text-xs text-red-500">{erro}</p>}
    </div>
  );
}
