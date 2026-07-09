'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Filiado,
  FORMACOES,
  FORMACAO_LABEL,
  SITUACOES,
  SITUACAO_LABEL,
  COREN_REGEX,
  mascararCoren,
} from '@/lib/filiados';
import { PhotoCropDialog } from '@/components/photo-crop-dialog';

const schema = z.object({
  nomeCompleto: z.string().min(3, 'Informe o nome'),
  cpf: z.string().min(11, 'CPF inválido'),
  rg: z.string().optional(),
  ufRg: z.string().optional(),
  dataNascimento: z.string().min(1, 'Obrigatório'),
  sexo: z.string().optional(),
  estadoCivil: z.string().optional(),
  naturalidade: z.string().optional(),
  telefonePrincipal: z.string().min(8, 'Telefone obrigatório'),
  telefoneSecundario: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  cep: z.string().optional(),
  endereco: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().min(1, 'Cidade obrigatória'),
  estado: z.string().min(1, 'Estado obrigatório'),
  formacao: z.enum(['ENFERMEIRO', 'TECNICO_ENFERMAGEM', 'AUXILIAR_ENFERMAGEM', 'OUTRO']),
  formacaoOutro: z.string().optional(),
  numeroCoren: z
    .string()
    .min(1, 'COREN obrigatório')
    .regex(COREN_REGEX, 'Formato: COREN-PI 000000-SSS (ex.: COREN-PI 123456-ENF)'),
  dataAdmissao: z.string().optional(),
  situacao: z.enum(['ATIVO', 'INATIVO', 'DESFILIADO']).optional(),
  v1Empresa: z.string().optional(),
  v1Cargo: z.string().optional(),
  v1Matricula: z.string().optional(),
  v2Empresa: z.string().optional(),
  v2Cargo: z.string().optional(),
  v2Matricula: z.string().optional(),
}).refine((d) => d.formacao !== 'OUTRO' || !!d.formacaoOutro?.trim(), {
  path: ['formacaoOutro'],
  message: 'Descreva a formação',
});
type FormData = z.infer<typeof schema>;

const SEXOS = ['MASCULINO', 'FEMININO', 'OUTRO'];
const ESTADOS_CIVIS = ['SOLTEIRO', 'CASADO', 'DIVORCIADO', 'VIUVO', 'UNIAO_ESTAVEL', 'OUTRO'];

function Campo({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {erro && <p className="text-xs text-red-500">{erro}</p>}
    </div>
  );
}

type Modo = 'criar' | 'editar' | 'recadastrar';

export function FiliadoForm({ inicial, modo = 'criar' }: { inicial?: Filiado; modo?: Modo }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [enviando, setEnviando] = useState(false);
  const [fotoPreview, setFotoPreview] = useState<string | null>(inicial?.fotoUrl ?? null);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [arquivoCrop, setArquivoCrop] = useState<File | null>(null);

  const v1 = inicial?.vinculos?.[0];
  const v2 = inicial?.vinculos?.[1];

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: inicial
      ? {
          nomeCompleto: inicial.nomeCompleto,
          cpf: inicial.cpf ?? '',
          rg: inicial.rg ?? '',
          ufRg: inicial.ufRg ?? '',
          dataNascimento: inicial.dataNascimento?.slice(0, 10) ?? '',
          sexo: inicial.sexo ?? '',
          estadoCivil: inicial.estadoCivil ?? '',
          naturalidade: inicial.naturalidade ?? '',
          telefonePrincipal: inicial.telefonePrincipal ?? '',
          telefoneSecundario: inicial.telefoneSecundario ?? '',
          email: inicial.email ?? '',
          cep: inicial.cep ?? '',
          endereco: inicial.endereco ?? '',
          numero: inicial.numero ?? '',
          complemento: inicial.complemento ?? '',
          bairro: inicial.bairro ?? '',
          cidade: inicial.cidade ?? '',
          estado: inicial.estado ?? '',
          formacao: (inicial.formacao as FormData['formacao']) ?? 'ENFERMEIRO',
          formacaoOutro: inicial.formacaoOutro ?? '',
          numeroCoren: inicial.numeroCoren ?? '',
          dataAdmissao: inicial.dataAdmissao?.slice(0, 10) ?? '',
          situacao: inicial.situacao,
          v1Empresa: v1?.empresa ?? '',
          v1Cargo: v1?.cargo ?? '',
          v1Matricula: v1?.matricula ?? '',
          v2Empresa: v2?.empresa ?? '',
          v2Cargo: v2?.cargo ?? '',
          v2Matricula: v2?.matricula ?? '',
        }
      : { formacao: 'ENFERMEIRO' },
  });

  function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setArquivoCrop(file); // abre o diálogo de recorte
    e.target.value = '';
  }

  function aplicarCrop(blob: Blob) {
    setFoto(blob);
    if (fotoPreview?.startsWith('blob:')) URL.revokeObjectURL(fotoPreview);
    setFotoPreview(URL.createObjectURL(blob));
    setArquivoCrop(null);
  }

  async function onSubmit(d: FormData) {
    setEnviando(true);
    try {
      const vinculos = [
        d.v1Empresa ? { empresa: d.v1Empresa, cargo: d.v1Cargo, matricula: d.v1Matricula, ordem: 1 } : null,
        d.v2Empresa ? { empresa: d.v2Empresa, cargo: d.v2Cargo, matricula: d.v2Matricula, ordem: 2 } : null,
      ].filter(Boolean);

      const payload: any = {
        nomeCompleto: d.nomeCompleto,
        cpf: d.cpf,
        rg: d.rg,
        ufRg: d.ufRg || undefined,
        dataNascimento: d.dataNascimento,
        sexo: d.sexo || undefined,
        estadoCivil: d.estadoCivil || undefined,
        naturalidade: d.naturalidade || undefined,
        telefonePrincipal: d.telefonePrincipal,
        telefoneSecundario: d.telefoneSecundario || undefined,
        email: d.email || undefined,
        cep: d.cep,
        endereco: d.endereco,
        numero: d.numero || undefined,
        complemento: d.complemento || undefined,
        bairro: d.bairro,
        cidade: d.cidade,
        estado: d.estado,
        formacao: d.formacao,
        formacaoOutro: d.formacao === 'OUTRO' ? d.formacaoOutro?.trim() : null,
        numeroCoren: d.numeroCoren,
        dataAdmissao: d.dataAdmissao || undefined,
        // Situação NÃO é enviada no cadastro (novo filiado nasce ATIVO no back).
        // Só acompanha edição; a troca "rica" (motivo/termo) tem fluxo próprio.
        situacao: modo === 'criar' ? undefined : d.situacao,
        vinculos,
      };

      let id: string;
      if (modo === 'criar') {
        id = (await api.post('/filiados', payload)).data.id;
      } else if (modo === 'recadastrar') {
        id = inicial!.id;
        await api.post(`/filiados/${id}/recadastramento`, payload);
      } else {
        id = inicial!.id;
        await api.patch(`/filiados/${id}`, payload);
      }

      if (foto) {
        const fd = new FormData();
        fd.append('foto', foto, 'foto.webp');
        await api.post(`/filiados/${id}/foto`, fd);
      }

      // Garante que a listagem e o perfil reflitam a foto/dados atualizados
      await qc.invalidateQueries({ queryKey: ['filiados'] });
      await qc.invalidateQueries({ queryKey: ['filiado', id] });

      toast.success(
        modo === 'criar' ? 'Filiado cadastrado' : modo === 'recadastrar' ? 'Recadastramento concluído' : 'Filiado atualizado',
      );
      router.push(`/filiados/${id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Erro ao salvar');
    } finally {
      setEnviando(false);
    }
  }

  const sel = 'h-12 w-full rounded-md border border-input md:h-10 bg-background px-3 text-base md:text-sm';

  return (
    <>
    {arquivoCrop && (
      <PhotoCropDialog
        arquivo={arquivoCrop}
        aspect={3 / 4}
        onConfirm={aplicarCrop}
        onClose={() => setArquivoCrop(null)}
      />
    )}
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Foto do filiado</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-6">
          {fotoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fotoPreview} alt="" className="h-24 w-24 rounded-xl object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Upload className="h-8 w-8" /></div>
          )}
          <div>
            <input type="file" accept="image/*" id="foto" className="hidden" onChange={onFoto} />
            <Button type="button" variant="outline" onClick={() => document.getElementById('foto')?.click()}>
              <Upload className="h-4 w-4" /> Selecionar foto
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">Otimizada e convertida para WebP no servidor.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Informações pessoais</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Nome completo *" erro={errors.nomeCompleto?.message}><Input {...register('nomeCompleto')} /></Campo>
          <Campo label="CPF *" erro={errors.cpf?.message}><Input {...register('cpf')} /></Campo>
          <Campo label="RG" erro={errors.rg?.message}><Input {...register('rg')} /></Campo>
          <Campo label="UF do RG"><Input maxLength={2} {...register('ufRg')} /></Campo>
          <Campo label="Data de nascimento *" erro={errors.dataNascimento?.message}><Input type="date" {...register('dataNascimento')} /></Campo>
          <Campo label="Sexo">
            <select className={sel} {...register('sexo')}><option value="">-</option>{SEXOS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </Campo>
          <Campo label="Estado civil">
            <select className={sel} {...register('estadoCivil')}><option value="">-</option>{ESTADOS_CIVIS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
          </Campo>
          <Campo label="Naturalidade"><Input {...register('naturalidade')} /></Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Contato</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Telefone principal *" erro={errors.telefonePrincipal?.message}><Input {...register('telefonePrincipal')} /></Campo>
          <Campo label="Telefone secundário"><Input {...register('telefoneSecundario')} /></Campo>
          <Campo label="E-mail" erro={errors.email?.message}><Input type="email" {...register('email')} /></Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Endereço</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="CEP" erro={errors.cep?.message}><Input {...register('cep')} /></Campo>
          <Campo label="Endereço" erro={errors.endereco?.message}><Input {...register('endereco')} /></Campo>
          <Campo label="Número"><Input {...register('numero')} /></Campo>
          <Campo label="Complemento"><Input {...register('complemento')} /></Campo>
          <Campo label="Bairro" erro={errors.bairro?.message}><Input {...register('bairro')} /></Campo>
          <Campo label="Cidade *" erro={errors.cidade?.message}><Input {...register('cidade')} /></Campo>
          <Campo label="Estado *" erro={errors.estado?.message}><Input maxLength={2} {...register('estado')} /></Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Informações profissionais</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Formação profissional *" erro={errors.formacao?.message}>
              <select className={sel} {...register('formacao')}>{FORMACOES.map((f) => <option key={f} value={f}>{FORMACAO_LABEL[f]}</option>)}</select>
            </Campo>
            {watch('formacao') === 'OUTRO' && (
              <Campo label="Qual a formação? *" erro={errors.formacaoOutro?.message}>
                <Input placeholder="Descreva a formação" {...register('formacaoOutro')} />
              </Campo>
            )}
            <Campo label="Número COREN *" erro={errors.numeroCoren?.message}>
              <Controller
                name="numeroCoren"
                control={control}
                render={({ field }) => (
                  <Input
                    placeholder="COREN-PI 000000-SSS"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(mascararCoren(e.target.value))}
                    onFocus={(e) => { if (!e.target.value) field.onChange('COREN-PI '); }}
                  />
                )}
              />
            </Campo>
            <Campo label="Data de admissão"><Input type="date" {...register('dataAdmissao')} /></Campo>
            {/* Situação só na edição — no cadastro o filiado nasce ATIVO. */}
            {modo !== 'criar' && (
              <Campo label="Situação">
                <select className={sel} {...register('situacao')}>{SITUACOES.map((s) => <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>)}</select>
              </Campo>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-muted-foreground">Vínculo profissional 1</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Campo label="Instituição/Empresa"><Input {...register('v1Empresa')} /></Campo>
              <Campo label="Cargo"><Input {...register('v1Cargo')} /></Campo>
              <Campo label="Matrícula"><Input {...register('v1Matricula')} /></Campo>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-muted-foreground">Vínculo profissional 2</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Campo label="Instituição/Empresa"><Input {...register('v2Empresa')} /></Campo>
              <Campo label="Cargo"><Input {...register('v2Cargo')} /></Campo>
              <Campo label="Matrícula"><Input {...register('v2Matricula')} /></Campo>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" disabled={enviando}>
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          {modo === 'criar' ? 'Cadastrar filiação' : modo === 'recadastrar' ? 'Concluir recadastramento' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
    </>
  );
}
