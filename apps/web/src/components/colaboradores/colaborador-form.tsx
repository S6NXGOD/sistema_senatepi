'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Save, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { mascararCpf } from '@/lib/utils';
import {
  Colaborador,
  ColaboradorPayload,
  TIPOS_VINCULO,
  TIPO_VINCULO_LABEL,
  STATUS_COLAB,
  STATUS_COLAB_LABEL,
  listarCargos,
  listarDepartamentos,
  listarEmpresas,
  criarCargo,
  criarDepartamento,
  criarEmpresa,
  criarColaborador,
  atualizarColaborador,
  enviarFotoColaborador,
  mascararCnpj,
} from '@/lib/colaboradores';
import { QuickAdd } from '@/components/colaboradores/quick-add';

const sel = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

const schema = z
  .object({
    nome: z.string().min(3, 'Informe o nome'),
    cpf: z.string().refine((v) => v.replace(/\D/g, '').length === 11, 'CPF inválido'),
    tipoVinculo: z.enum(['CLT', 'PJ', 'ESTAGIO', 'TERCEIRIZADO']),
    status: z.enum(['ATIVO', 'INATIVO', 'AFASTADO', 'FERIAS', 'DESLIGADO']),
    cargoId: z.string().min(1, 'Selecione o cargo'),
    departamentoId: z.string().min(1, 'Selecione o departamento'),
    empresaId: z.string().optional(),
    dataNascimento: z.string().optional(),
    telefone: z.string().optional(),
    email: z.string().email('E-mail inválido').optional().or(z.literal('')),
    dataAdmissao: z.string().optional(),
    cep: z.string().optional(),
    logradouro: z.string().optional(),
    numero: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    uf: z.string().optional(),
    vencimentoContrato: z.string().optional(),
    instituicaoEnsino: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if ((d.tipoVinculo === 'PJ' || d.tipoVinculo === 'TERCEIRIZADO') && !d.empresaId)
      ctx.addIssue({ code: 'custom', path: ['empresaId'], message: 'Selecione a empresa' });
    if (d.tipoVinculo === 'ESTAGIO' && !d.instituicaoEnsino?.trim())
      ctx.addIssue({ code: 'custom', path: ['instituicaoEnsino'], message: 'Informe a instituição de ensino' });
  });
type FormData = z.infer<typeof schema>;

export function ColaboradorForm({ inicial }: { inicial?: Colaborador }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [enviando, setEnviando] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(inicial?.fotoUrl ?? null);

  function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return;
    setFoto(f);
    if (fotoPreview?.startsWith('blob:')) URL.revokeObjectURL(fotoPreview);
    setFotoPreview(URL.createObjectURL(f));
  }

  const { data: cargos } = useQuery({ queryKey: ['cadastros-cargos'], queryFn: listarCargos });
  const { data: departamentos } = useQuery({ queryKey: ['cadastros-departamentos'], queryFn: listarDepartamentos });
  const { data: empresas } = useQuery({ queryKey: ['cadastros-empresas'], queryFn: listarEmpresas });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: inicial
      ? {
          nome: inicial.nome,
          cpf: inicial.cpf ? mascararCpf(inicial.cpf) : '',
          tipoVinculo: inicial.tipoVinculo,
          status: inicial.status,
          cargoId: inicial.cargoId,
          departamentoId: inicial.departamentoId,
          empresaId: inicial.empresaId ?? '',
          dataNascimento: inicial.dataNascimento?.slice(0, 10) ?? '',
          telefone: inicial.telefone ?? '',
          email: inicial.email ?? '',
          dataAdmissao: inicial.dataAdmissao?.slice(0, 10) ?? '',
          cep: inicial.cep ?? '',
          logradouro: inicial.logradouro ?? '',
          numero: inicial.numero ?? '',
          bairro: inicial.bairro ?? '',
          cidade: inicial.cidade ?? '',
          uf: inicial.uf ?? '',
          vencimentoContrato: inicial.vencimentoContrato?.slice(0, 10) ?? '',
          instituicaoEnsino: inicial.instituicaoEnsino ?? '',
        }
      : { tipoVinculo: 'CLT', status: 'ATIVO' },
  });

  const tipoVinculo = watch('tipoVinculo');
  const mostraEmpresa = tipoVinculo === 'PJ' || tipoVinculo === 'TERCEIRIZADO';
  const mostraEstagio = tipoVinculo === 'ESTAGIO';
  const mostraVencimento = mostraEmpresa || mostraEstagio;

  async function onSubmit(d: FormData) {
    setEnviando(true);
    try {
      const payload: ColaboradorPayload = {
        nome: d.nome,
        cpf: d.cpf.replace(/\D/g, ''),
        tipoVinculo: d.tipoVinculo,
        status: d.status,
        cargoId: d.cargoId,
        departamentoId: d.departamentoId,
        empresaId: mostraEmpresa ? d.empresaId || undefined : undefined,
        dataNascimento: d.dataNascimento || undefined,
        telefone: d.telefone || undefined,
        email: d.email || undefined,
        dataAdmissao: d.dataAdmissao || undefined,
        cep: d.cep || undefined,
        logradouro: d.logradouro || undefined,
        numero: d.numero || undefined,
        bairro: d.bairro || undefined,
        cidade: d.cidade || undefined,
        uf: d.uf || undefined,
        vencimentoContrato: mostraVencimento ? d.vencimentoContrato || undefined : undefined,
        instituicaoEnsino: mostraEstagio ? d.instituicaoEnsino || undefined : undefined,
      };
      let id: string;
      if (inicial) { await atualizarColaborador(inicial.id, payload); id = inicial.id; }
      else { id = (await criarColaborador(payload)).id; }
      if (foto) await enviarFotoColaborador(id, foto);
      await qc.invalidateQueries({ queryKey: ['colaboradores'] });
      await qc.invalidateQueries({ queryKey: ['colaborador', id] });
      toast.success(inicial ? 'Colaborador atualizado.' : 'Colaborador cadastrado.');
      router.push('/colaboradores');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível salvar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Dados pessoais */}
      <Card>
        <CardHeader><CardTitle>Dados pessoais</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Foto de perfil (upload) */}
          <div className="flex flex-col items-center gap-4 sm:col-span-2 sm:flex-row lg:col-span-3">
            {fotoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotoPreview} alt="" className="h-20 w-20 shrink-0 rounded-full border object-cover" />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Upload className="h-7 w-7" />
              </div>
            )}
            <div>
              <input type="file" accept="image/*" id="foto-colab" className="hidden" onChange={onFoto} />
              <Button type="button" variant="outline" onClick={() => document.getElementById('foto-colab')?.click()}>
                <Upload className="h-4 w-4" /> Selecionar foto
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">Enviada ao salvar. JPG ou PNG.</p>
            </div>
          </div>
          <Campo label="Nome *" erro={errors.nome?.message}><Input {...register('nome')} /></Campo>
          <Campo label="CPF *" erro={errors.cpf?.message}>
            <Controller name="cpf" control={control} render={({ field }) => (
              <Input inputMode="numeric" placeholder="000.000.000-00" value={field.value ?? ''} onChange={(e) => field.onChange(mascararCpf(e.target.value))} />
            )} />
          </Campo>
          <Campo label="Data de nascimento"><Input type="date" {...register('dataNascimento')} /></Campo>
          <Campo label="Telefone"><Input {...register('telefone')} /></Campo>
          <Campo label="E-mail" erro={errors.email?.message}><Input type="email" {...register('email')} /></Campo>
          <Campo label="Data de admissão"><Input type="date" {...register('dataAdmissao')} /></Campo>
        </CardContent>
      </Card>

      {/* Vínculo e lotação */}
      <Card>
        <CardHeader><CardTitle>Vínculo e lotação</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Tipo de vínculo *">
            <select className={sel} {...register('tipoVinculo')}>
              {TIPOS_VINCULO.map((t) => <option key={t} value={t}>{TIPO_VINCULO_LABEL[t]}</option>)}
            </select>
          </Campo>
          <Campo label="Status">
            <select className={sel} {...register('status')}>
              {STATUS_COLAB.map((s) => <option key={s} value={s}>{STATUS_COLAB_LABEL[s]}</option>)}
            </select>
          </Campo>
          <div className="hidden lg:block" />
          <Campo label="Cargo *" erro={errors.cargoId?.message}>
            <div className="flex gap-2">
              <select className={sel} {...register('cargoId')}>
                <option value="">Selecione…</option>
                {cargos?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <QuickAdd
                label="Cargo"
                campos={[{ name: 'nome', label: 'Nome do cargo', placeholder: 'Ex.: Advogado(a)' }]}
                onCriar={(v) => criarCargo(v.nome)}
                onCriado={(id) => { qc.invalidateQueries({ queryKey: ['cadastros-cargos'] }); setValue('cargoId', id, { shouldValidate: true }); }}
              />
            </div>
          </Campo>
          <Campo label="Departamento *" erro={errors.departamentoId?.message}>
            <div className="flex gap-2">
              <select className={sel} {...register('departamentoId')}>
                <option value="">Selecione…</option>
                {departamentos?.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
              </select>
              <QuickAdd
                label="Departamento"
                campos={[{ name: 'nome', label: 'Nome do departamento', placeholder: 'Ex.: Jurídico' }]}
                onCriar={(v) => criarDepartamento(v.nome)}
                onCriado={(id) => { qc.invalidateQueries({ queryKey: ['cadastros-departamentos'] }); setValue('departamentoId', id, { shouldValidate: true }); }}
              />
            </div>
          </Campo>
          <div className="hidden lg:block" />

          {/* Condicional: PJ / Terceirizado → Empresa */}
          {mostraEmpresa && (
            <Campo label="Empresa *" erro={errors.empresaId?.message}>
              <div className="flex gap-2">
                <select className={sel} {...register('empresaId')}>
                  <option value="">Selecione…</option>
                  {empresas?.map((e) => <option key={e.id} value={e.id}>{e.razaoSocial}</option>)}
                </select>
                <QuickAdd
                  label="Empresa"
                  campos={[
                    { name: 'razaoSocial', label: 'Razão social', placeholder: 'Ex.: ACME LTDA' },
                    { name: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00', mask: mascararCnpj },
                  ]}
                  onCriar={(v) => criarEmpresa({ razaoSocial: v.razaoSocial, cnpj: v.cnpj })}
                  onCriado={(id) => { qc.invalidateQueries({ queryKey: ['cadastros-empresas'] }); setValue('empresaId', id, { shouldValidate: true }); }}
                />
              </div>
            </Campo>
          )}
          {/* Condicional: Estágio → Instituição de ensino */}
          {mostraEstagio && (
            <Campo label="Instituição de ensino *" erro={errors.instituicaoEnsino?.message}>
              <Input {...register('instituicaoEnsino')} />
            </Campo>
          )}
          {/* Condicional: vencimento do contrato (PJ/Terceirizado/Estágio) */}
          {mostraVencimento && (
            <Campo label="Vencimento do contrato"><Input type="date" {...register('vencimentoContrato')} /></Campo>
          )}
        </CardContent>
      </Card>

      {/* Endereço */}
      <Card>
        <CardHeader><CardTitle>Endereço</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="CEP"><Input {...register('cep')} /></Campo>
          <Campo label="Logradouro"><Input {...register('logradouro')} /></Campo>
          <Campo label="Número"><Input {...register('numero')} /></Campo>
          <Campo label="Bairro"><Input {...register('bairro')} /></Campo>
          <Campo label="Cidade"><Input {...register('cidade')} /></Campo>
          <Campo label="UF"><Input maxLength={2} {...register('uf')} /></Campo>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push('/colaboradores')} className="w-full sm:w-auto">Cancelar</Button>
        <Button type="submit" disabled={enviando} className="w-full sm:w-auto">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {enviando ? 'Salvando…' : inicial ? 'Salvar alterações' : 'Cadastrar colaborador'}
        </Button>
      </div>
    </form>
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
