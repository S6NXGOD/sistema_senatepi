'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, Save, UserRound, Scale, Users, ShieldCheck, Lock, Unlock, Briefcase, Camera, Trash2,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhotoCropDialog } from '@/components/photo-crop-dialog';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  MODULOS, PERFIS, PRESETS_PERFIL, NIVEL_LABEL, ModuloKey, NivelPermissao, PerfilUsuario,
} from '@/lib/permissoes';
import {
  criarUsuario, atualizarUsuario, enviarAvatarUsuario, removerAvatarUsuario, UsuarioSistema,
} from '@/lib/usuarios';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';
const NIVEIS: NivelPermissao[] = ['SEM_ACESSO', 'VISUALIZAR', 'EDITAR'];
const ICONE_PERFIL: Record<PerfilUsuario, any> = {
  TRIAGEM: UserRound, ADVOGADO: Scale, COORDENACAO: Users, ADMINISTRADOR: ShieldCheck,
};

/** Matriz completa (todos os módulos) a partir de um preset + overrides do usuário. */
function matrizInicial(role: PerfilUsuario, permissoes?: Record<string, string> | null) {
  const base = { ...PRESETS_PERFIL[role] };
  if (permissoes) {
    for (const m of MODULOS) {
      const v = permissoes[m.key];
      if (v && (NIVEIS as string[]).includes(v)) base[m.key] = v as NivelPermissao;
    }
  }
  return base as Record<ModuloKey, NivelPermissao>;
}

export function UsuarioFormModal({
  open, onClose, onSalvo, editar,
}: {
  open: boolean;
  onClose: () => void;
  onSalvo: () => void;
  editar?: UsuarioSistema | null;
}) {
  const { user } = useAuth();
  const ehEdicao = !!editar;
  /** Editando a si mesmo: não pode desativar a própria conta (anti-lockout). */
  const ehProprio = !!editar && editar.id === user?.id;

  const [nome, setNome] = useState('');
  const [nomeExibicao, setNomeExibicao] = useState('');
  const [email, setEmail] = useState('');
  const [oab, setOab] = useState('');
  const [oabUf, setOabUf] = useState('');
  const [senha, setSenha] = useState('');
  const [ativo, setAtivo] = useState(true);
  /**
   * Em um usuário NOVO a função vem vazia de propósito: ela define as permissões
   * e quais campos fazem sentido (OAB, por ex.). Escolher primeiro evita criar
   * alguém com o perfil errado por descuido. Na edição já existe uma função.
   */
  const [role, setRole] = useState<PerfilUsuario | ''>('');
  const [matriz, setMatriz] = useState<Record<ModuloKey, NivelPermissao>>(() => matrizInicial('TRIAGEM'));

  // Foto de perfil (upload): preview atual + blob pendente + flag de remoção.
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [fotoBlob, setFotoBlob] = useState<Blob | null>(null);
  const [removerFoto, setRemoverFoto] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setFotoBlob(null); setRemoverFoto(false); setCropFile(null);
    if (editar) {
      setNome(editar.nome);
      setNomeExibicao(editar.nomeExibicao ?? '');
      setEmail(editar.email);
      setOab(editar.oab ?? '');
      setOabUf(editar.oabUf ?? '');
      setSenha('');
      setAtivo(editar.ativo);
      setRole(editar.role);
      setMatriz(matrizInicial(editar.role, editar.permissoes ?? undefined));
      setAvatarPreview(editar.avatarUrl ?? null);
    } else {
      setNome(''); setNomeExibicao(''); setEmail(''); setSenha(''); setOab(''); setOabUf('');
      setAtivo(true); setRole(''); setMatriz(matrizInicial('TRIAGEM'));
      setAvatarPreview(null);
    }
  }, [open, editar]);

  function aoSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // permite reselecionar o mesmo arquivo
    if (f) setCropFile(f);
  }
  function aoRecortar(blob: Blob) {
    setAvatarPreview((prev) => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
    setFotoBlob(blob);
    setRemoverFoto(false);
    setCropFile(null);
  }
  function removerFotoAgora() {
    setAvatarPreview((prev) => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return null; });
    setFotoBlob(null);
    setRemoverFoto(true);
  }

  const adminLock = role === 'ADMINISTRADOR';
  const secoes = useMemo(() => {
    const grupos = ['Principal', 'Operacional', 'Administração'] as const;
    return grupos.map((g) => ({ grupo: g, itens: MODULOS.filter((m) => m.grupo === g) }));
  }, []);

  function selecionarPerfil(p: PerfilUsuario) {
    setRole(p);
    setMatriz(matrizInicial(p)); // o preset preenche a matriz
  }
  function setNivel(mod: ModuloKey, nivel: NivelPermissao) {
    setMatriz((m) => ({ ...m, [mod]: nivel }));
  }

  const salvar = useMutation({
    mutationFn: async () => {
      // O botão fica bloqueado sem função; a checagem aqui é a rede de segurança
      // que também estreita o tipo para o payload da API.
      if (!role) throw new Error('Selecione a função do usuário.');
      const permissoes = adminLock ? undefined : matriz; // admin = acesso total
      const base = {
        nome: nome.trim(),
        nomeExibicao: nomeExibicao.trim() || undefined,
        email: email.trim(),
        // OAB só é enviada para o perfil de advogado (limpa ao trocar de perfil).
        oab: role === 'ADVOGADO' ? oab.trim() : '',
        oabUf: role === 'ADVOGADO' ? oabUf.trim() : '',
        role,
        // Trava anti-lockout: ninguém desativa a própria conta (o backend também barra).
        ativo: ehProprio ? true : ativo,
        permissoes,
      };
      const salvo = ehEdicao
        ? await atualizarUsuario(editar!.id, { ...base, ...(senha ? { senha } : {}) })
        : await criarUsuario({ ...base, senha });
      // Foto: envia o recorte pendente ou remove a existente (após ter o id).
      if (fotoBlob) await enviarAvatarUsuario(salvo.id, fotoBlob);
      else if (ehEdicao && removerFoto) await removerAvatarUsuario(salvo.id);
      return salvo;
    },
    onSuccess: () => {
      toast.success(ehEdicao ? 'Usuário atualizado.' : 'Usuário criado.');
      onSalvo();
      onClose();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível salvar o usuário.');
    },
  });

  function submeter() {
    if (!role) return toast.error('Selecione a função do usuário para continuar.');
    if (nome.trim().length < 2) return toast.error('Informe o nome completo.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast.error('Informe um e-mail válido.');
    if (!ehEdicao && senha.length < 6) return toast.error('A senha deve ter ao menos 6 caracteres.');
    if (ehEdicao && senha && senha.length < 6) return toast.error('A nova senha deve ter ao menos 6 caracteres.');
    salvar.mutate();
  }

  return (
    <>
    <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-xl">
      <div className="flex items-center justify-between border-b p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <ShieldCheck className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">{ehEdicao ? 'Editar Usuário' : 'Novo Usuário'}</h3>
            <p className="text-sm text-muted-foreground">Perfil de acesso e permissões</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {/* PASSO 1 — Função. Sem ela, o resto do formulário nem aparece. */}
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            Função {!ehEdicao && <span className="text-red-600">*</span>}
          </p>
          {!role && (
            <p className="mb-2 text-xs text-muted-foreground">
              Comece escolhendo a função — ela define as permissões e os campos do cadastro.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PERFIS.map((p) => {
              const Icone = ICONE_PERFIL[p.key];
              const ativoCard = role === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => selecionarPerfil(p.key)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    ativoCard
                      ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-300 dark:bg-brand-900/20'
                      : 'border-input hover:border-brand-300 hover:bg-muted/40',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <Icone className="h-5 w-5 text-brand-800 dark:text-brand-400" />
                    {ativoCard ? (
                      <Unlock className="h-4 w-4 text-brand-600" />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground/50" />
                    )}
                  </div>
                  <p className="text-sm font-semibold">{p.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.descricao}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* PASSO 2 em diante — liberado após escolher a função */}
        {!role ? null : (
        <>
        {/* Foto de perfil */}
        <div className="flex items-center gap-4">
          {avatarPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarPreview} alt="" className="h-20 w-20 shrink-0 rounded-full border object-cover" />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-brand-400 text-2xl font-bold text-brand-900">
              {(nome.trim().charAt(0) || '?').toUpperCase()}
            </div>
          )}
          <div className="space-y-1.5">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={aoSelecionarArquivo} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Camera className="h-4 w-4" /> {avatarPreview ? 'Trocar foto' : 'Enviar foto'}
              </Button>
              {avatarPreview && (
                <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={removerFotoAgora}>
                  <Trash2 className="h-4 w-4" /> Remover
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">JPG ou PNG · recorte quadrado.</p>
          </div>
        </div>

        {/* Dados */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nome Completo *</label>
            <Input placeholder="ex: João Silva" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nome de Exibição</label>
            <Input placeholder="ex: Dr. João" value={nomeExibicao} onChange={(e) => setNomeExibicao(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">E-mail (login) *</label>
          <Input type="email" placeholder="email@sindicato.org" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <p className="text-xs text-muted-foreground">É com este e-mail que a pessoa entra no sistema.</p>
        </div>

        {/* OAB — só faz sentido para quem atua como advogado */}
        {role === 'ADVOGADO' && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Inscrição na OAB</label>
              <Input placeholder="ex: 12345" value={oab} onChange={(e) => setOab(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">UF</label>
              <Input placeholder="PI" maxLength={2} className="uppercase" value={oabUf} onChange={(e) => setOabUf(e.target.value.toUpperCase())} />
            </div>
            <p className="col-span-3 -mt-0.5 text-xs text-muted-foreground">
              Usada para reconhecer automaticamente este advogado nos processos e sugeri-lo como responsável.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{ehEdicao ? 'Nova senha' : 'Senha *'}</label>
            <Input
              type="password"
              placeholder={ehEdicao ? 'Deixe em branco para manter' : '••••••••'}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Status</label>
            <select
              className={cn(inputCls, ehProprio && 'cursor-not-allowed opacity-60')}
              value={ativo ? 'ATIVO' : 'INATIVO'}
              onChange={(e) => setAtivo(e.target.value === 'ATIVO')}
              disabled={ehProprio}
            >
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </select>
            {ehProprio && (
              <p className="text-xs text-muted-foreground">
                Você não pode desativar a própria conta — peça a outro administrador.
              </p>
            )}
          </div>
        </div>

        {/* Permissões de módulos */}
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Lock className="h-4 w-4 text-muted-foreground" /> Permissões de módulos
          </p>
          {adminLock && (
            <p className="mb-3 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:bg-brand-900/20 dark:text-brand-300">
              O Administrador tem <strong>acesso total</strong> a todos os módulos e é o único que pode excluir registros.
            </p>
          )}
          <div className="space-y-4">
            {secoes.map((secao) => (
              <div key={secao.grupo} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {secao.grupo}
                </p>
                {secao.itens.map((mod) => (
                  <div key={mod.key} className="rounded-lg border p-2.5">
                    <p className="mb-2 text-sm font-medium">{mod.label}</p>
                    <div className="grid grid-cols-3 gap-1">
                      {NIVEIS.map((n) => {
                        const sel = (adminLock ? 'EDITAR' : matriz[mod.key]) === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            disabled={adminLock}
                            onClick={() => setNivel(mod.key, n)}
                            className={cn(
                              'rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
                              sel
                                ? 'bg-brand-800 text-white shadow-sm'
                                : 'bg-muted text-muted-foreground hover:bg-muted-foreground/10',
                            )}
                          >
                            {NIVEL_LABEL[n]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        </>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
        <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
        <Button onClick={submeter} disabled={salvar.isPending || !role} title={!role ? 'Escolha a função primeiro' : undefined}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
        </Button>
      </div>
    </Sheet>

    {cropFile && (
      <PhotoCropDialog arquivo={cropFile} aspect={1} onConfirm={aoRecortar} onClose={() => setCropFile(null)} />
    )}
    </>
  );
}
