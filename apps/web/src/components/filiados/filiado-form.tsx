'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  LIMITES_NASCIMENTO, LIMITES_DATA_PASSADA, nascimentoPlausivel, dataNaoFutura,
  MSG_IDADE_IMPLAUSIVEL, MSG_DATA_FUTURA,
} from '@/lib/datas-limite';
import { UFS, mascararCep, buscarCep, municipiosDaUF } from '@/lib/endereco';
import { toast } from 'sonner';
import { Loader2, Upload, Plus, Trash2, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Filiado,
  FORMACOES,
  FORMACAO_LABEL,
  SITUACOES,
  SITUACAO_LABEL,
  COREN_REGEX,
  mascararCoren,
  TIPOS_DEPENDENTE,
  MODALIDADES_CONTRIBUICAO,
  type DependenteFiliado,
} from '@/lib/filiados';
import { LocaisTrabalhoSection, type LocalTrabalho } from '@/components/filiados/locais-trabalho-section';
import { PhotoCropDialog } from '@/components/photo-crop-dialog';
import { travado, AVISO_TRAVADO, type CampoImutavel } from '@/lib/campos-imutaveis';
import { campoVisivel } from '@/tenant.config';
import { V } from '@/lib/vocabulario';

// O local de trabalho e a sua edição vivem em locais-trabalho-section.tsx.

export const schema = z.object({
  nomeCompleto: z.string().min(3, 'Informe o nome'),
  cpf: z.string().min(11, 'CPF inválido'),
  rg: z.string().optional(),
  ufRg: z.string().optional(),
  dataNascimento: z
    .string()
    .min(1, 'Obrigatório')
    .refine(nascimentoPlausivel, MSG_IDADE_IMPLAUSIVEL),
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
  /**
   * FORMAÇÃO e COREN são declarados OPCIONAIS aqui e exigidos no `superRefine`
   * abaixo, conforme a instalação.
   *
   * Exigi-los no schema quebrava o cadastro inteiro numa instalação que esconde
   * os dois: o campo não é renderizado, o zod reprova mesmo assim, e o erro fica
   * preso num campo invisível — formulário que não envia e não diz por quê.
   *
   * Opcional-com-superRefine em vez de um schema condicional porque assim o
   * `FormData` continua tendo UM tipo só; um `z.infer` que muda por cliente
   * viraria união e espalharia `as` pelo arquivo.
   */
  formacao: z.enum(['ENFERMEIRO', 'TECNICO_ENFERMAGEM', 'AUXILIAR_ENFERMAGEM', 'OUTRO']).optional(),
  formacaoOutro: z.string().optional(),
  numeroCoren: z.string().optional(),
  dataAdmissao: z.string().optional().refine(dataNaoFutura, MSG_DATA_FUTURA),
  /** Vínculo com o EMPREGADOR — ver o enum no schema. */
  vinculoFuncional: z.enum(['ATIVO', 'APOSENTADO', 'PENSIONISTA']).or(z.literal('')).optional(),
  situacao: z.enum(['ATIVO', 'INATIVO', 'DESFILIADO']).optional(),
  modalidadeContribuicao: z.enum(['DESCONTO_FOLHA', 'AVULSO', 'PENSIONISTA']).optional().or(z.literal('')),
}).superRefine((d, ctx) => {
  // Onde os campos APARECEM, a exigência é exatamente a de sempre. Onde não
  // aparecem, não há o que exigir.
  if (campoVisivel('formacao')) {
    if (!d.formacao) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['formacao'], message: 'Formação obrigatória' });
    }
    if (d.formacao === 'OUTRO' && !d.formacaoOutro?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['formacaoOutro'], message: 'Descreva a formação' });
    }
  }
  if (campoVisivel('numeroCoren')) {
    const coren = d.numeroCoren?.trim();
    if (!coren) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numeroCoren'], message: 'COREN obrigatório' });
    } else if (!COREN_REGEX.test(coren)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['numeroCoren'],
        message: 'Formato: COREN-PI 000000-SSS (ex.: COREN-PI 123456-ENF)',
      });
    }
  }
});
type FormData = z.infer<typeof schema>;

/**
 * Formação inicial do formulário — e `undefined` onde o campo está escondido.
 *
 * Era `'ENFERMEIRO'` fixo. Numa instalação sem o campo, isso não seria só um
 * default inútil: TODO cadastro sairia gravado como enfermeiro, sem ninguém
 * escolher e sem nada na tela para desmentir. Default invisível é dado
 * inventado.
 */
const PADRAO_FORMACAO: FormData['formacao'] = campoVisivel('formacao')
  ? 'ENFERMEIRO'
  : undefined;

const SEXOS = ['MASCULINO', 'FEMININO', 'OUTRO'];
const ESTADOS_CIVIS = ['SOLTEIRO', 'CASADO', 'DIVORCIADO', 'VIUVO', 'UNIAO_ESTAVEL', 'OUTRO'];

function Campo({ label, erro, children, bloqueado }: {
  label: string;
  erro?: string;
  children: React.ReactNode;
  /** Dado que não muda e já está preenchido — só a edição direta altera. */
  bloqueado?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-sm font-medium">
        {label}
        {bloqueado && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
      </label>
      {children}
      {bloqueado && <p className="text-[11px] text-muted-foreground">{AVISO_TRAVADO}</p>}
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

  // Endereço assistido: ViaCEP + municípios da UF (IBGE).
  const [cepBuscando, setCepBuscando] = useState(false);
  const [cepAviso, setCepAviso] = useState<string | null>(null);
  const [municipios, setMunicipios] = useState<string[]>([]);

  // Vínculos e dependentes ficam fora do react-hook-form: são listas de
  // tamanho variável, e o zod aqui cuida só dos campos fixos.
  const [vinculos, setVinculos] = useState<LocalTrabalho[]>(
    () => inicial?.vinculos?.map((v) => ({
      empresa: v.empresa ?? '',
      parteExternaId: v.parteExternaId ?? undefined,
      cargo: v.cargo ?? '',
      lotacao: v.lotacao ?? '',
      matricula: v.matricula ?? '',
      descontoEmFolha: v.descontoEmFolha ?? false,
    })) ?? [],
  );
  const [dependentes, setDependentes] = useState<DependenteFiliado[]>(
    () => inicial?.dependentes?.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      nome: d.nome,
      cpf: d.cpf ?? '',
      dataNascimento: d.dataNascimento?.slice(0, 10) ?? '',
    })) ?? [],
  );

  /**
   * No RECADASTRAMENTO os dados que não mudam ficam travados (a correção é
   * feita na tela de Editar). Em 'criar' e 'editar' tudo segue liberado.
   */
  const bloq = (campo: CampoImutavel) =>
    modo === 'recadastrar' && travado(campo, (inicial as never)?.[campo]);

  const mudarDependente = (i: number, campo: keyof DependenteFiliado, valor: string) =>
    setDependentes((l) => l.map((d, j) => (j === i ? { ...d, [campo]: valor } : d)));

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
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
          formacao: (inicial.formacao as FormData['formacao']) ?? PADRAO_FORMACAO,
          formacaoOutro: inicial.formacaoOutro ?? '',
          numeroCoren: inicial.numeroCoren ?? '',
          dataAdmissao: inicial.dataAdmissao?.slice(0, 10) ?? '',
          vinculoFuncional: inicial.vinculoFuncional ?? '',
          situacao: inicial.situacao,
          modalidadeContribuicao: inicial.modalidadeContribuicao ?? '',
        }
      : { formacao: PADRAO_FORMACAO },
  });

  // Municípios da UF escolhida alimentam o autocomplete da cidade. O resultado
  // é cacheado em memória, então trocar de UF ida e volta não refaz a chamada.
  const ufSelecionada = watch('estado');
  useEffect(() => {
    let vivo = true;
    if (!ufSelecionada || ufSelecionada.length !== 2) { setMunicipios([]); return; }
    municipiosDaUF(ufSelecionada).then((l) => { if (vivo) setMunicipios(l); });
    return () => { vivo = false; };
  }, [ufSelecionada]);

  /**
   * ViaCEP: preenche logradouro, bairro, cidade e UF assim que o CEP fica
   * completo. Não bloqueia nada — CEP inexistente ou serviço fora do ar apenas
   * deixa os campos para digitação manual.
   */
  async function preencherPorCep(valorMascarado: string) {
    const digitos = valorMascarado.replace(/\D/g, '');
    setCepAviso(null);
    if (digitos.length !== 8) return;

    setCepBuscando(true);
    try {
      const e = await buscarCep(digitos);
      if (!e) {
        setCepAviso('CEP não encontrado — preencha o endereço manualmente.');
        return;
      }
      // `shouldDirty` para o formulário saber que mudou; sem `shouldValidate`
      // porque o preenchimento automático não é erro do usuário.
      if (e.logradouro) setValue('endereco', e.logradouro, { shouldDirty: true });
      if (e.bairro) setValue('bairro', e.bairro, { shouldDirty: true });
      if (e.cidade) setValue('cidade', e.cidade, { shouldDirty: true });
      if (e.uf) setValue('estado', e.uf, { shouldDirty: true });
      if (e.parcial) {
        setCepAviso('CEP geral da cidade — informe a rua e o bairro.');
      }
    } finally {
      setCepBuscando(false);
    }
  }

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
      // Linhas em branco são descartadas; a lista enviada substitui a atual.
      const vinculosPayload = vinculos
        .filter((v) => v.empresa?.trim())
        .map((v, i) => ({
          empresa: v.empresa.trim(),
          parteExternaId: v.parteExternaId || undefined,
          cargo: v.cargo?.trim() || undefined,
          lotacao: v.lotacao?.trim() || undefined,
          matricula: v.matricula?.trim() || undefined,
          descontoEmFolha: !!v.descontoEmFolha,
          ordem: i + 1,
        }));

      const dependentesPayload = dependentes
        .filter((x) => x.nome?.trim() && x.dataNascimento)
        .map((x) => ({
          id: x.id,
          tipo: x.tipo,
          nome: x.nome.trim(),
          cpf: x.cpf?.replace(/\D/g, '') || undefined,
          dataNascimento: x.dataNascimento.slice(0, 10),
        }));

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
        // `|| undefined` e não o valor cru: com o campo escondido, `numeroCoren`
        // chegaria como string vazia e a API a reprovaria no formato do COREN —
        // um erro de validação vindo de um campo que a pessoa nem viu.
        formacao: d.formacao || undefined,
        formacaoOutro: d.formacao === 'OUTRO' ? d.formacaoOutro?.trim() : null,
        numeroCoren: d.numeroCoren?.trim() || undefined,
        dataAdmissao: d.dataAdmissao || undefined,
        vinculoFuncional: d.vinculoFuncional || undefined,
        modalidadeContribuicao: d.modalidadeContribuicao || undefined,
        // Situação NÃO é enviada no cadastro (novo filiado nasce ATIVO no back).
        // Só acompanha edição; a troca "rica" (motivo/termo) tem fluxo próprio.
        situacao: modo === 'criar' ? undefined : d.situacao,
        vinculos: vinculosPayload,
        dependentes: dependentesPayload,
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
    <form
      onSubmit={handleSubmit(onSubmit)}
      /**
       * Enter em campo de texto NÃO envia o cadastro.
       *
       * O HTML manda um formulário quando se aperta Enter num input de linha
       * única — é o "implicit submission". Num formulário curto isso ajuda;
       * neste, que tem seis blocos e dependentes, atrapalha: ao digitar o CEP
       * o gesto natural é apertar Enter para "buscar o endereço", e o que
       * acontecia era o cadastro inteiro ser submetido pela metade,
       * respondendo com "Telefone obrigatório", "Estado obrigatório" e o
       * formulário pintado de vermelho antes da pessoa terminar.
       *
       * O envio continua acontecendo pelo botão "Salvar", e Enter segue
       * funcionando onde faz sentido: dentro do combobox (escolhe a opção),
       * em textarea (quebra linha) e sobre um botão em foco.
       */
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const alvo = e.target as HTMLElement;
        const tag = alvo.tagName;
        if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
        if (alvo.getAttribute('type') === 'submit') return;
        e.preventDefault();
      }}
      className="space-y-6"
    >
      <Card>
        <CardHeader><CardTitle>Foto do {V.filiado}</CardTitle></CardHeader>
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
          <Campo label="CPF *" erro={errors.cpf?.message} bloqueado={bloq('cpf')}>
            <Input readOnly={bloq('cpf')} className={bloq('cpf') ? 'bg-muted' : ''} {...register('cpf')} />
          </Campo>
          <Campo label="RG" erro={errors.rg?.message} bloqueado={bloq('rg')}>
            <Input readOnly={bloq('rg')} className={bloq('rg') ? 'bg-muted' : ''} {...register('rg')} />
          </Campo>
          <Campo label="UF do RG" bloqueado={bloq('ufRg')}>
            <Input readOnly={bloq('ufRg')} className={bloq('ufRg') ? 'bg-muted' : ''} maxLength={2} {...register('ufRg')} />
          </Campo>
          <Campo label="Data de nascimento *" erro={errors.dataNascimento?.message} bloqueado={bloq('dataNascimento')}>
            <Input readOnly={bloq('dataNascimento')} className={bloq('dataNascimento') ? 'bg-muted' : ''} type="date" {...LIMITES_NASCIMENTO} {...register('dataNascimento')} />
          </Campo>
          <Campo label="Sexo">
            <select className={sel} {...register('sexo')}><option value="">-</option>{SEXOS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </Campo>
          <Campo label="Estado civil">
            <select className={sel} {...register('estadoCivil')}><option value="">-</option>{ESTADOS_CIVIS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
          </Campo>
          <Campo label="Naturalidade" bloqueado={bloq('naturalidade')}>
            <Input readOnly={bloq('naturalidade')} className={bloq('naturalidade') ? 'bg-muted' : ''} {...register('naturalidade')} />
          </Campo>
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
          {/* CEP puxa o resto do endereço. Os campos preenchidos continuam
              EDITÁVEIS de propósito: o ViaCEP erra e desatualiza, e travá-los
              deixaria o operador sem saída num caso legítimo. */}
          <Campo label="CEP" erro={errors.cep?.message}>
            <div className="relative">
              <Controller
                name="cep"
                control={control}
                render={({ field }) => (
                  <Input
                    inputMode="numeric"
                    placeholder="00000-000"
                    value={field.value ?? ''}
                    onChange={(e) => {
                      const v = mascararCep(e.target.value);
                      field.onChange(v);
                      preencherPorCep(v);
                    }}
                  />
                )}
              />
              {cepBuscando && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            {cepAviso && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{cepAviso}</p>}
          </Campo>
          <Campo label="Endereço" erro={errors.endereco?.message}><Input {...register('endereco')} /></Campo>
          <Campo label="Número"><Input {...register('numero')} /></Campo>
          <Campo label="Complemento"><Input {...register('complemento')} /></Campo>
          <Campo label="Bairro" erro={errors.bairro?.message}><Input {...register('bairro')} /></Campo>
          {/**
            * ESTADO VEM ANTES DA CIDADE — e isto é correção de um defeito, não
            * preferência de layout.
            *
            * A lista de municípios é carregada A PARTIR da UF (IBGE). Com a
            * cidade em cima, o campo aparecia primeiro dizendo "Escolha a UF
            * primeiro": a tela pedia para preencher de baixo para cima. Quem
            * seguisse a ordem natural batia num campo inútil, descia, voltava.
            *
            * A ordem dos campos é a ordem da dependência entre eles.
            */}
          <Campo label="Estado *" erro={errors.estado?.message}>
            <Controller
              name="estado"
              control={control}
              render={({ field }) => (
                <Combobox
                  value={field.value ?? ''}
                  onChange={(uf) => {
                    // Trocar de UF invalida a cidade: município de um estado não
                    // existe no outro, e manter o antigo cria um endereço
                    // impossível que ninguém percebe até a correspondência voltar.
                    if (uf !== field.value) setValue('cidade', '', { shouldDirty: true });
                    field.onChange(uf);
                  }}
                  opcoes={UFS.map((u) => ({ valor: u.sigla, rotulo: u.nome, detalhe: u.sigla }))}
                  placeholder="Digite o estado ou a sigla…"
                  aria-invalid={!!errors.estado}
                />
              )}
            />
          </Campo>
          {/* Cidade: municípios da UF (IBGE) em combobox com filtro que ignora
              acento. Aceita texto livre de propósito — se o IBGE não responder,
              digitar à mão precisa continuar possível. */}
          <Campo label="Cidade *" erro={errors.cidade?.message}>
            <Controller
              name="cidade"
              control={control}
              render={({ field }) => (
                <Combobox
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  opcoes={municipios.map((m) => ({ valor: m, rotulo: m }))}
                  placeholder={ufSelecionada ? 'Digite para filtrar…' : 'Escolha a UF primeiro'}
                  aviso={
                    ufSelecionada
                      ? 'Não foi possível carregar os municípios — digite o nome.'
                      : 'Escolha o estado para listar os municípios.'
                  }
                  permitirLivre
                  aria-invalid={!!errors.cidade}
                />
              )}
            />
          </Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Informações profissionais</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* FORMAÇÃO e COREN são da enfermagem. Num sindicato de servidores
                municipais o que vale é o cargo, que já existe no vínculo
                profissional — por isso os dois campos podem ser desligados por
                instalação, sem sumir do banco de quem os usa. */}
            {campoVisivel('formacao') && (
              <>
                <Campo label="Formação profissional *" erro={errors.formacao?.message}>
                  <select className={sel} {...register('formacao')}>{FORMACOES.map((f) => <option key={f} value={f}>{FORMACAO_LABEL[f]}</option>)}</select>
                </Campo>
                {watch('formacao') === 'OUTRO' && (
                  <Campo label="Qual a formação? *" erro={errors.formacaoOutro?.message}>
                    <Input placeholder="Descreva a formação" {...register('formacaoOutro')} />
                  </Campo>
                )}
              </>
            )}
            {campoVisivel('numeroCoren') && (
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
            )}
            <Campo label="Vínculo funcional">
              {/* Vínculo com o EMPREGADOR — diferente da situação no sindicato:
                  um aposentado segue filiado, e um servidor na ativa pode estar
                  desfiliado. */}
              <select className={sel} {...register('vinculoFuncional')}>
                <option value="">Não informado</option>
                <option value="ATIVO">Ativo</option>
                <option value="APOSENTADO">Aposentado</option>
                <option value="PENSIONISTA">Pensionista</option>
              </select>
            </Campo>
            <Campo label="Data de admissão" erro={errors.dataAdmissao?.message}>
              <Input type="date" {...LIMITES_DATA_PASSADA} {...register('dataAdmissao')} />
            </Campo>
            {/* Como este filiado contribui. "Desconto em folha" aponta para os
                locais marcados abaixo — é lá que se sabe em QUAL folha. */}
            <Campo label="Modalidade de contribuição">
              <select className={sel} {...register('modalidadeContribuicao')}>
                <option value="">Não informada</option>
                {MODALIDADES_CONTRIBUICAO.map((m) => (
                  <option key={m.valor} value={m.valor}>{m.label}</option>
                ))}
              </select>
            </Campo>
            {/*
              Situação só na edição — no cadastro o filiado nasce ATIVO.

              DESFILIADO NÃO ENTRA NA LISTA. Marcar a saída aqui pulava tudo que
              ela exige — motivo padronizado (é o que responde "quantos saíram
              por inadimplência?"), mês de corte, Termo assinado, histórico e
              auditoria — e a volta, no sentido contrário, deixava os cinco
              campos da saída gravados num cadastro já ativo. A API recusa as
              duas transições desde então; tirar a opção do seletor evita
              oferecer um caminho que só sabe dar erro.

              Quem já está desfiliado vê o estado aqui, mas em campo travado: as
              ações "Desfiliar" e "Reativar", no menu da linha, são as portas.
            */}
            {modo !== 'criar' && (
              <Campo label="Situação">
                {inicial?.situacao === 'DESFILIADO' ? (
                  <p className="flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground">
                    Desfiliado — use “Reativar” no menu para retornar ao quadro.
                  </p>
                ) : (
                  <select className={sel} {...register('situacao')}>
                    {SITUACOES.filter((s) => s !== 'DESFILIADO').map((s) => (
                      <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>
                    ))}
                  </select>
                )}
              </Campo>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Vínculos profissionais — sem limite: duplo vínculo é a regra na
          enfermagem, e o servidor com dois contratos de 20h também tem dois. */}
      <Card>
        <CardHeader>
          <CardTitle>Vínculos profissionais</CardTitle>
        </CardHeader>
        <CardContent>
          <LocaisTrabalhoSection
            locais={vinculos}
            onChange={setVinculos}
            modalidade={watch('modalidadeContribuicao')}
          />
        </CardContent>
      </Card>

      {/* Dependentes: entram junto com o cadastro, na mesma gravação. */}
      <Card>
        <CardHeader><CardTitle>Dependentes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Cônjuge e filhos(as). Só um cônjuge por filiado.
          </p>
          {dependentes.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum dependente cadastrado.
            </p>
          )}
          {dependentes.map((d, i) => (
            <div key={d.id ?? `novo-${i}`} className="space-y-4 rounded-xl border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Dependente {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setDependentes((l) => l.filter((_, j) => j !== i))}
                  className="flex items-center gap-1 text-xs text-red-600 hover:underline dark:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remover
                </button>
              </div>
              <Campo label="Nome completo">
                <Input value={d.nome ?? ''} onChange={(e) => mudarDependente(i, 'nome', e.target.value)} />
              </Campo>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Campo label="Parentesco">
                  <select
                    className={sel}
                    value={d.tipo}
                    onChange={(e) => mudarDependente(i, 'tipo', e.target.value)}
                  >
                    {TIPOS_DEPENDENTE.map((t) => (
                      <option key={t.valor} value={t.valor}>{t.rotulo}</option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Data de nascimento">
                  <Input
                    type="date"
                    {...LIMITES_NASCIMENTO}
                    value={d.dataNascimento?.slice(0, 10) ?? ''}
                    onChange={(e) => mudarDependente(i, 'dataNascimento', e.target.value)}
                  />
                </Campo>
                <Campo label="CPF">
                  <Input
                    value={d.cpf ?? ''}
                    onChange={(e) => mudarDependente(i, 'cpf', e.target.value)}
                    placeholder="000.000.000-00"
                  />
                </Campo>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() =>
              setDependentes((l) => [...l, { tipo: 'FILHO', nome: '', cpf: '', dataNascimento: '' }])
            }
          >
            <Plus className="h-4 w-4" /> Adicionar dependente
          </Button>
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
