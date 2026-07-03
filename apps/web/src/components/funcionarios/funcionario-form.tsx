'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Funcionario, STATUS, STATUS_LABEL, TIPO_LABEL, TIPOS } from '@/lib/funcionarios';

const schema = z.object({
  nome: z.string().min(3, 'Informe o nome'),
  cpf: z.string().min(11, 'CPF inválido'),
  dataNascimento: z.string().min(1, 'Obrigatório'),
  telefone: z.string().min(8, 'Telefone obrigatório'),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  dataAdmissao: z.string().min(1, 'Obrigatório'),
  cargo: z.string().min(1, 'Obrigatório'),
  departamento: z.string().min(1, 'Obrigatório'),
  tipo: z.enum(['FUNCIONARIO', 'PRESTADOR_SERVICO', 'ESTAGIARIO', 'TERCEIRIZADO']),
  status: z.enum(['ATIVO', 'INATIVO', 'AFASTADO', 'FERIAS', 'DESLIGADO']).optional(),
  cep: z.string().optional(),
  endereco: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function Campo({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {erro && <p className="text-xs text-red-500">{erro}</p>}
    </div>
  );
}

export function FuncionarioForm({ inicial }: { inicial?: Funcionario }) {
  const router = useRouter();
  const editando = !!inicial;
  const [enviando, setEnviando] = useState(false);
  const [fotoPreview, setFotoPreview] = useState<string | null>(inicial?.fotoUrl ?? null);
  const fotoRef = useRef<File | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: inicial
      ? {
          nome: inicial.nome,
          cpf: inicial.cpf,
          dataNascimento: inicial.dataNascimento?.slice(0, 10) ?? '',
          telefone: inicial.telefone ?? '',
          email: inicial.email ?? '',
          dataAdmissao: inicial.dataAdmissao?.slice(0, 10) ?? '',
          cargo: inicial.cargo ?? '',
          departamento: inicial.departamento ?? '',
          tipo: inicial.tipo,
          status: inicial.status,
          cep: inicial.cep ?? '',
          endereco: inicial.endereco ?? '',
          numero: inicial.numero ?? '',
          complemento: inicial.complemento ?? '',
          bairro: inicial.bairro ?? '',
          cidade: inicial.cidade ?? '',
          estado: inicial.estado ?? '',
        }
      : { tipo: 'FUNCIONARIO', status: 'ATIVO' },
  });

  function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    fotoRef.current = file;
    setFotoPreview(URL.createObjectURL(file));
  }

  async function onSubmit(data: FormData) {
    setEnviando(true);
    try {
      const payload = { ...data, email: data.email || undefined };
      const id = editando
        ? (await api.patch(`/funcionarios/${inicial!.id}`, payload), inicial!.id)
        : (await api.post('/funcionarios', payload)).data.id;

      if (fotoRef.current) {
        const fd = new FormData();
        fd.append('foto', fotoRef.current);
        await api.post(`/funcionarios/${id}/foto`, fd);
      }

      toast.success(editando ? 'Funcionário atualizado' : 'Funcionário cadastrado');
      router.push(`/funcionarios/${id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Erro ao salvar');
    } finally {
      setEnviando(false);
    }
  }

  const inputCls = 'h-12 w-full rounded-md border border-input md:h-10 bg-background px-3 text-base md:text-sm';

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Foto */}
      <Card>
        <CardHeader><CardTitle>Foto do colaborador</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-6">
          {fotoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fotoPreview} alt="" className="h-24 w-24 rounded-xl object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Upload className="h-8 w-8" />
            </div>
          )}
          <div>
            <input type="file" accept="image/*" id="foto" className="hidden" onChange={onFoto} />
            <Button type="button" variant="outline" onClick={() => document.getElementById('foto')?.click()}>
              <Upload className="h-4 w-4" /> Selecionar foto
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">A imagem é otimizada e convertida para WebP no servidor.</p>
          </div>
        </CardContent>
      </Card>

      {/* Dados pessoais */}
      <Card>
        <CardHeader><CardTitle>Dados pessoais</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Nome completo *" erro={errors.nome?.message}><Input {...register('nome')} /></Campo>
          <Campo label="CPF *" erro={errors.cpf?.message}><Input {...register('cpf')} /></Campo>
          <Campo label="Data de nascimento *" erro={errors.dataNascimento?.message}><Input type="date" {...register('dataNascimento')} /></Campo>
          <Campo label="Telefone *" erro={errors.telefone?.message}><Input {...register('telefone')} /></Campo>
          <Campo label="E-mail" erro={errors.email?.message}><Input type="email" {...register('email')} /></Campo>
        </CardContent>
      </Card>

      {/* Dados funcionais */}
      <Card>
        <CardHeader><CardTitle>Dados funcionais</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Data de admissão *" erro={errors.dataAdmissao?.message}><Input type="date" {...register('dataAdmissao')} /></Campo>
          <Campo label="Cargo *" erro={errors.cargo?.message}><Input {...register('cargo')} /></Campo>
          <Campo label="Departamento *" erro={errors.departamento?.message}><Input {...register('departamento')} /></Campo>
          <Campo label="Tipo *" erro={errors.tipo?.message}>
            <select className={inputCls} {...register('tipo')}>
              {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </select>
          </Campo>
          <Campo label="Status" erro={errors.status?.message}>
            <select className={inputCls} {...register('status')}>
              {STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Campo>
        </CardContent>
      </Card>

      {/* Endereço */}
      <Card>
        <CardHeader><CardTitle>Endereço</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="CEP"><Input {...register('cep')} /></Campo>
          <Campo label="Endereço"><Input {...register('endereco')} /></Campo>
          <Campo label="Número"><Input {...register('numero')} /></Campo>
          <Campo label="Complemento"><Input {...register('complemento')} /></Campo>
          <Campo label="Bairro"><Input {...register('bairro')} /></Campo>
          <Campo label="Cidade"><Input {...register('cidade')} /></Campo>
          <Campo label="Estado"><Input {...register('estado')} /></Campo>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          {editando ? 'Salvar alterações' : 'Cadastrar'}
        </Button>
      </div>
    </form>
  );
}
