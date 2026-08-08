'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { User, ShieldCheck, Loader2, Save, KeyRound, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdentidadeVisualTab } from '@/components/configuracoes/identidade-visual-tab';
import { Palette } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PhotoCropDialog } from '@/components/photo-crop-dialog';
import { useAuth } from '@/lib/auth';
import {
  getMeuPerfil,
  atualizarPerfil,
  alterarSenha,
  enviarAvatar,
  removerAvatar,
  ROLE_LABEL,
  Perfil,
} from '@/lib/profile';

export default function ConfiguracoesPage() {
  const { data: perfil, isLoading, refetch } = useQuery({
    queryKey: ['perfil-me'],
    queryFn: getMeuPerfil,
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configurações</h2>
        <p className="text-sm text-muted-foreground">Gerencie seus dados de perfil e de acesso.</p>
      </div>

      {isLoading || !perfil ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" />
        </div>
      ) : (
        <Tabs defaultValue="perfil" className="space-y-6">
          <TabsList>
            <TabsTrigger value="perfil"><User className="h-4 w-4" /> Perfil</TabsTrigger>
            <TabsTrigger value="seguranca"><ShieldCheck className="h-4 w-4" /> Segurança</TabsTrigger>
            {/* A marca é da INSTALAÇÃO, não da pessoa — por isso só o
                administrador vê a aba. A API confere de novo: esconder o botão
                não protege nada sozinho. */}
            {perfil.role === 'ADMINISTRADOR' && (
              <TabsTrigger value="identidade"><Palette className="h-4 w-4" /> Identidade visual</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="perfil">
            <PerfilTab perfil={perfil} onSalvo={() => refetch()} />
          </TabsContent>

          <TabsContent value="seguranca">
            <SegurancaTab />
          </TabsContent>

          {perfil.role === 'ADMINISTRADOR' && (
            <TabsContent value="identidade">
              <IdentidadeVisualTab />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Perfil
// ---------------------------------------------------------------------------

const perfilSchema = z.object({
  nome: z.string().min(2, 'Informe o nome completo'),
  nomeExibicao: z.string().max(120).optional().or(z.literal('')),
  email: z.string().email('E-mail inválido'),
});
type PerfilForm = z.infer<typeof perfilSchema>;

function PerfilTab({ perfil, onSalvo }: { perfil: Perfil; onSalvo: () => void }) {
  const { atualizarUsuario } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarAtual, setAvatarAtual] = useState<string | null>(perfil.avatarUrl);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

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
      nomeExibicao: perfil.nomeExibicao ?? '',
      email: perfil.email,
    },
  });

  // Mantém o formulário em sincronia caso o perfil seja recarregado.
  useEffect(() => {
    setAvatarAtual(perfil.avatarUrl);
    reset({ nome: perfil.nome, nomeExibicao: perfil.nomeExibicao ?? '', email: perfil.email });
  }, [perfil, reset]);

  const nome = watch('nome');
  const previewUrl = avatarAtual || '';

  function aoSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reselecionar o mesmo arquivo
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem.');
      return;
    }
    setCropFile(file); // abre o recorte antes de enviar
  }

  async function enviarRecorte(blob: Blob) {
    setCropFile(null);
    setEnviandoFoto(true);
    try {
      const p = await enviarAvatar(blob);
      setAvatarAtual(p.avatarUrl);
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
      const p = await removerAvatar();
      setAvatarAtual(p.avatarUrl);
      atualizarUsuario({ avatarUrl: p.avatarUrl });
      toast.success('Foto removida.');
      onSalvo();
    } catch {
      toast.error('Não foi possível remover a foto.');
    }
  }

  async function onSubmit(d: PerfilForm) {
    try {
      const atualizado = await atualizarPerfil({
        nome: d.nome.trim(),
        nomeExibicao: (d.nomeExibicao ?? '').trim(), // vazio remove o apelido
        email: d.email.trim(),
      });
      atualizarUsuario({
        nome: atualizado.nome,
        nomeExibicao: atualizado.nomeExibicao ?? null,
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
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
                {(nome || perfil.nome).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex flex-col items-center gap-1.5 sm:items-start">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={aoSelecionarArquivo} />
                <Button type="button" variant="outline" size="sm" disabled={enviandoFoto} onClick={() => fileRef.current?.click()}>
                  {enviandoFoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {enviandoFoto ? 'Enviando…' : avatarAtual ? 'Trocar foto' : 'Enviar foto'}
                </Button>
                {avatarAtual && (
                  <Button type="button" variant="ghost" size="sm" onClick={removerFoto}>
                    Remover
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPG ou PNG · recorte quadrado.</p>
            </div>
          </div>

          <Campo label="Nome completo" erro={errors.nome?.message}>
            <Input {...register('nome')} />
          </Campo>

          <Campo label="Nome de exibição" erro={errors.nomeExibicao?.message}>
            <Input placeholder="ex: Dr. João — deixe vazio para usar o nome completo" {...register('nomeExibicao')} />
          </Campo>

          <Campo label="E-mail (usado para entrar no sistema)" erro={errors.email?.message}>
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

        {cropFile && (
          <PhotoCropDialog
            arquivo={cropFile}
            aspect={1}
            onConfirm={enviarRecorte}
            onClose={() => setCropFile(null)}
          />
        )}
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
