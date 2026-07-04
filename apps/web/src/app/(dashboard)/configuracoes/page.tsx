'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { User, ShieldCheck, Loader2, Save, KeyRound, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import {
  getMeuPerfil,
  atualizarPerfil,
  alterarSenha,
  enviarAvatar,
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
  avatarUrl: z.string().url('Informe uma URL válida').optional().or(z.literal('')),
});
type PerfilForm = z.infer<typeof perfilSchema>;

function PerfilTab({ perfil, onSalvo }: { perfil: Perfil; onSalvo: () => void }) {
  const { atualizarUsuario } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarAtual, setAvatarAtual] = useState<string | null>(perfil.avatarUrl);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PerfilForm>({
    resolver: zodResolver(perfilSchema),
    defaultValues: {
      nome: perfil.nome,
      email: perfil.email,
      avatarUrl: '',
    },
  });

  // Mantém o formulário em sincronia caso o perfil seja recarregado.
  useEffect(() => {
    setAvatarAtual(perfil.avatarUrl);
    reset({ nome: perfil.nome, email: perfil.email, avatarUrl: '' });
  }, [perfil, reset]);

  const urlDigitada = watch('avatarUrl');
  const nome = watch('nome');
  const previewUrl = (urlDigitada && urlDigitada.trim()) || avatarAtual || '';

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem.');
      return;
    }
    setEnviandoFoto(true);
    try {
      const p = await enviarAvatar(file);
      setAvatarAtual(p.avatarUrl);
      setValue('avatarUrl', ''); // a foto enviada tem precedência sobre a URL
      atualizarUsuario({ avatarUrl: p.avatarUrl });
      toast.success('Foto de perfil atualizada.');
      onSalvo();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível enviar a foto.');
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function removerFoto() {
    try {
      const p = await atualizarPerfil({ avatarUrl: '' });
      setAvatarAtual(p.avatarUrl);
      setValue('avatarUrl', '');
      atualizarUsuario({ avatarUrl: p.avatarUrl });
      toast.success('Foto removida.');
      onSalvo();
    } catch {
      toast.error('Não foi possível remover a foto.');
    }
  }

  async function onSubmit(d: PerfilForm) {
    try {
      const payload: { nome: string; email: string; avatarUrl?: string } = {
        nome: d.nome.trim(),
        email: d.email.trim(),
      };
      // Só envia avatarUrl se uma URL foi digitada (não sobrescreve a foto enviada).
      if (d.avatarUrl && d.avatarUrl.trim()) payload.avatarUrl = d.avatarUrl.trim();

      const atualizado = await atualizarPerfil(payload);
      setAvatarAtual(atualizado.avatarUrl);
      setValue('avatarUrl', '');
      atualizarUsuario({
        nome: atualizado.nome,
        email: atualizado.email,
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
          {/* Foto de perfil: preview + upload */}
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Foto de perfil"
                className="h-20 w-20 shrink-0 rounded-full border object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-senatepi-100 text-2xl font-bold text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-300">
                {(nome || perfil.nome).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onUpload} />
              <Button type="button" variant="outline" size="sm" disabled={enviandoFoto} onClick={() => fileRef.current?.click()}>
                {enviandoFoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {enviandoFoto ? 'Enviando…' : 'Enviar foto'}
              </Button>
              {avatarAtual && (
                <Button type="button" variant="ghost" size="sm" onClick={removerFoto}>
                  Remover
                </Button>
              )}
            </div>
          </div>

          {/* Alternativa: informar a foto por URL */}
          <Campo label="… ou cole a URL de uma imagem" erro={errors.avatarUrl?.message}>
            <Input type="url" placeholder="https://…/foto.jpg" {...register('avatarUrl')} />
          </Campo>

          <Campo label="Nome de exibição" erro={errors.nome?.message}>
            <Input {...register('nome')} />
          </Campo>

          <Campo label="E-mail" erro={errors.email?.message}>
            <Input type="email" {...register('email')} />
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
