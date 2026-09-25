'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Briefcase, Camera, Loader2, Lock, Plus, Save, Trash2, TriangleAlert } from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import {
  ErroPortal,
  buscarMeuCadastro,
  enviarMinhaFoto,
  salvarMeuCadastro,
  type MeuCadastro,
  type MeuVinculo,
} from '@/lib/portal-filiado';
import { formatDataPura } from '@/lib/data-pura';
import { mascaraCpf } from '@/lib/colonia';
import { moduloAtivo, tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';
import { cn } from '@/lib/utils';

type Tipo = 'texto' | 'data' | 'email' | 'tel' | 'cpf' | 'escolha';

interface Campo {
  chave: string;
  rotulo: string;
  tipo?: Tipo;
  largura?: 'cheia' | 'meia' | 'curta';
  opcoes?: Array<[string, string]>;
  dica?: string;
  /** Mexer nele tem consequência que a pessoa precisa saber ANTES. */
  alerta?: string;
}

/**
 * OS CAMPOS, NA ORDEM DE UMA CONVERSA — e não na ordem do banco.
 *
 * Quem é você, onde te achamos, onde você trabalha. É a sequência da ficha de
 * papel que a secretaria preenche há anos, e a pessoa já a conhece.
 */
const IDENTIDADE: Campo[] = [
  { chave: 'nomeCompleto', rotulo: 'Nome completo', largura: 'cheia' },
  {
    chave: 'cpf',
    rotulo: 'CPF',
    tipo: 'cpf',
    largura: 'meia',
    alerta: 'É com ele que você entra no portal. Mudando aqui, muda o seu login.',
  },
  { chave: 'dataNascimento', rotulo: 'Data de nascimento', tipo: 'data', largura: 'meia' },
  { chave: 'rg', rotulo: 'RG', largura: 'meia' },
  { chave: 'ufRg', rotulo: 'UF do RG', largura: 'curta' },
  {
    chave: 'sexo',
    rotulo: 'Sexo',
    tipo: 'escolha',
    largura: 'meia',
    opcoes: [
      ['MASCULINO', 'Masculino'],
      ['FEMININO', 'Feminino'],
      ['OUTRO', 'Outro'],
    ],
  },
  {
    chave: 'estadoCivil',
    rotulo: 'Estado civil',
    tipo: 'escolha',
    largura: 'meia',
    opcoes: [
      ['SOLTEIRO', 'Solteiro(a)'],
      ['CASADO', 'Casado(a)'],
      ['DIVORCIADO', 'Divorciado(a)'],
      ['VIUVO', 'Viúvo(a)'],
      ['UNIAO_ESTAVEL', 'União estável'],
      ['OUTRO', 'Outro'],
    ],
  },
  { chave: 'naturalidade', rotulo: 'Cidade onde nasceu', largura: 'meia' },
];

const CONTATO: Campo[] = [
  { chave: 'cep', rotulo: 'CEP', largura: 'meia' },
  { chave: 'endereco', rotulo: 'Endereço', largura: 'cheia' },
  { chave: 'numero', rotulo: 'Número', largura: 'curta' },
  { chave: 'complemento', rotulo: 'Complemento', largura: 'meia' },
  { chave: 'bairro', rotulo: 'Bairro', largura: 'meia' },
  { chave: 'cidade', rotulo: 'Cidade', largura: 'meia' },
  { chave: 'estado', rotulo: 'UF', largura: 'curta' },
  { chave: 'telefonePrincipal', rotulo: 'Telefone', tipo: 'tel', largura: 'meia' },
  { chave: 'telefoneSecundario', rotulo: 'Outro telefone', tipo: 'tel', largura: 'meia' },
  {
    chave: 'email',
    rotulo: 'E-mail',
    tipo: 'email',
    largura: 'cheia',
    dica: 'Deixe em branco se não usar.',
  },
];

const PROFISSIONAL: Campo[] = [
  {
    chave: 'formacao',
    rotulo: 'Formação',
    tipo: 'escolha',
    largura: 'meia',
    opcoes: [
      ['ENFERMEIRO', 'Enfermeiro(a)'],
      ['TECNICO_ENFERMAGEM', 'Técnico(a) em Enfermagem'],
      ['AUXILIAR_ENFERMAGEM', 'Auxiliar de Enfermagem'],
      ['OUTRO', 'Outro'],
    ],
  },
  { chave: 'formacaoOutro', rotulo: 'Qual?', largura: 'meia' },
  { chave: 'numeroCoren', rotulo: 'Nº do COREN', largura: 'meia' },
  { chave: 'dataAdmissao', rotulo: 'Admitido(a) em', tipo: 'data', largura: 'meia' },
];

const LARGURA = { cheia: 'sm:col-span-6', meia: 'sm:col-span-3', curta: 'sm:col-span-2' };

/** `formacao` e `numeroCoren` não existem no SINDSERM — ver `camposOcultos`. */
const CAMPO_DO_CLIENTE: Record<string, () => boolean> = {
  formacao: () => moduloAtivo('filiados') && tenant.id === 'senatepi',
  formacaoOutro: () => tenant.id === 'senatepi',
  numeroCoren: () => tenant.id === 'senatepi',
};

/**
 * O VALOR DO BANCO COMO O CAMPO PRECISA VÊ-LO.
 *
 * Duas conversões, e as duas dão defeito se ficarem só no `onChange`: a data
 * chega em ISO e o `input[type=date]` só entende "AAAA-MM-DD"; o CPF chega cru
 * e aparecia como "89009126404" até a pessoa digitar alguma coisa. Pior: a
 * comparação de "o que mudou" usava o valor CRU de um lado e o MASCARADO do
 * outro, então abrir a tela já marcava o CPF como alterado.
 */
function paraOCampo(c: Campo, bruto: string | null): string {
  if (!bruto) return '';
  if (c.tipo === 'data') return bruto.slice(0, 10);
  if (c.tipo === 'cpf') return mascaraCpf(bruto);
  return bruto;
}

export default function MeuCadastroPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-filiado', 'cadastro'],
    queryFn: buscarMeuCadastro,
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [vinculos, setVinculos] = useState<MeuVinculo[]>([]);

  useEffect(() => {
    if (!data) return;
    const inicial: Record<string, string> = {};
    for (const c of [...IDENTIDADE, ...CONTATO, ...PROFISSIONAL]) {
      inicial[c.chave] = paraOCampo(c, (data as never)[c.chave] as string | null);
    }
    setForm(inicial);
    setVinculos(data.vinculos.map((v) => ({ ...v })));
  }, [data]);

  /*
    A LISTA DE EDITÁVEIS VEM DO SERVIDOR — é a mesma do link de
    recadastramento, por construção. Sem isto, a tela teria a própria cópia da
    regra e as duas divergiriam na primeira mudança, como campo que a pessoa
    preenche e o servidor ignora em silêncio.
  */
  const editavel = useMemo(() => new Set(data?.editaveis ?? []), [data]);
  const visivel = (c: Campo) =>
    editavel.has(c.chave) && (CAMPO_DO_CLIENTE[c.chave]?.() ?? true);

  const mudouCampos = useMemo(() => {
    if (!data) return [];
    return [...IDENTIDADE, ...CONTATO, ...PROFISSIONAL]
      .filter(visivel)
      .filter(
        (c) => (form[c.chave] ?? '') !== paraOCampo(c, (data as never)[c.chave] as string | null),
      )
      .map((c) => c.chave);
  }, [form, data, editavel]);

  const mudouVinculos = useMemo(() => {
    if (!data) return false;
    return JSON.stringify(vinculos) !== JSON.stringify(data.vinculos);
  }, [vinculos, data]);

  const alteracoes = mudouCampos.length + (mudouVinculos ? 1 : 0);

  const salvar = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const chave of mudouCampos) {
        const valor = form[chave]?.trim() ?? '';
        // A máscara é da TELA. O banco guarda dígito, e é por ele que o login entra.
        payload[chave] = chave === 'cpf' ? valor.replace(/\D/g, '') || null : valor || null;
      }
      if (mudouVinculos) {
        payload.vinculos = vinculos
          .filter((v) => v.empresa.trim())
          .map((v) => ({
            empresa: v.empresa.trim(),
            cargo: v.cargo?.trim() || undefined,
            matricula: v.matricula?.trim() || undefined,
          }));
      }
      return salvarMeuCadastro(payload);
    },
    onSuccess: (novo) => {
      toast.success('Cadastro atualizado. Obrigado!');
      qc.setQueryData(['portal-filiado', 'cadastro'], novo);
      qc.invalidateQueries({ queryKey: ['portal-filiado', 'resumo'] });
    },
    onError: (e) => toast.error((e as ErroPortal).message || 'Não foi possível salvar.'),
  });

  return (
    <CascaDoPortal>
      <h1 className="mb-1 text-lg font-bold">Meu cadastro</h1>
      <p className="mb-4 text-xs leading-snug text-muted-foreground">
        Confira e corrija o que estiver desatualizado. O que você digitar vale na hora — ninguém
        precisa aprovar.
      </p>

      {isLoading || !data ? (
        <Carregando texto="Carregando…">
          <EsqueletoLinhas quantidade={3} altura={110} className="divide-y-0 space-y-3" />
        </Carregando>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (alteracoes) salvar.mutate();
          }}
          className="space-y-4 pb-20"
        >
          <MinhaFoto cadastro={data} />

          <Bloco titulo="Quem é você" campos={IDENTIDADE} form={form} setForm={setForm} visivel={visivel} />
          <Bloco
            titulo="Onde te encontrar"
            descricao={`É por aqui que o ${tenant.sigla} fala com você.`}
            campos={CONTATO}
            form={form}
            setForm={setForm}
            visivel={visivel}
          />
          <Bloco titulo="Sua profissão" campos={PROFISSIONAL} form={form} setForm={setForm} visivel={visivel} />

          <LocaisDeTrabalho vinculos={vinculos} setVinculos={setVinculos} />

          <SoLeitura cadastro={data} />

          {/*
            A BARRA DE SALVAR FICA GRUDADA NO PÉ DA TELA.

            O formulário tem trinta campos: um botão no fim obrigaria a rolar
            tudo de volta depois de corrigir o telefone lá em cima. No celular
            isso é a diferença entre salvar e desistir.
          */}
          <div
            className="fixed inset-x-0 bottom-14 z-10 border-t bg-card/95 px-4 py-3 backdrop-blur sm:bottom-0"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
          >
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <span className="flex-1 text-xs text-muted-foreground">
                {alteracoes
                  ? `${alteracoes} ${alteracoes === 1 ? 'alteração' : 'alterações'} para salvar`
                  : 'Nada alterado'}
              </span>
              <Button type="submit" disabled={!alteracoes || salvar.isPending}>
                {salvar.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" /> Salvar
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      )}
    </CascaDoPortal>
  );
}

/**
 * A FOTO — o motivo número um deste portal existir, do ponto de vista do cadastro.
 *
 * MEDIDO: 1 de 5.810 ativos tem foto. Nenhum esforço da secretaria resolve
 * isso; quem tem a câmera na mão é a pessoa. `capture="user"` abre a câmera
 * frontal direto no celular, sem passar pela galeria.
 */
function MinhaFoto({ cadastro }: { cadastro: MeuCadastro }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const enviar = useMutation({
    mutationFn: (arquivo: File) => enviarMinhaFoto(arquivo),
    onSuccess: () => {
      toast.success('Foto atualizada. Ela aparece na sua carteirinha.');
      qc.invalidateQueries({ queryKey: ['portal-filiado', 'cadastro'] });
      qc.invalidateQueries({ queryKey: ['portal-filiado', 'carteirinha'] });
    },
    onError: (e) => toast.error((e as ErroPortal).message),
  });

  const iniciais = (() => {
    const particulas = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
    const partes = cadastro.nomeCompleto
      .trim()
      .split(/\s+/)
      .filter((p) => p && !particulas.has(p.toLowerCase()));
    if (!partes.length) return '?';
    return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
  })();

  return (
    <section className="flex items-center gap-4 rounded-2xl border bg-card p-5">
      {cadastro.fotoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
        <img
          src={cadastro.fotoUrl}
          alt="Sua foto"
          className="h-20 w-20 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-2xl font-bold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
          {iniciais}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Sua foto</p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          {cadastro.fotoUrl
            ? 'É ela que sai na sua carteirinha.'
            : 'Ainda não temos sua foto — ela sai na carteirinha.'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="user"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) enviar.mutate(arquivo);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={enviar.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {enviar.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
          {cadastro.fotoUrl ? 'Trocar foto' : 'Tirar ou escolher foto'}
        </Button>
      </div>
    </section>
  );
}

function Bloco({
  titulo,
  descricao,
  campos,
  form,
  setForm,
  visivel,
}: {
  titulo: string;
  descricao?: string;
  campos: Campo[];
  form: Record<string, string>;
  setForm: (f: (a: Record<string, string>) => Record<string, string>) => void;
  visivel: (c: Campo) => boolean;
}) {
  const mostrados = campos.filter(visivel);
  if (!mostrados.length) return null;

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-sm font-bold">{titulo}</h2>
      {descricao && <p className="mt-0.5 text-[11px] text-muted-foreground">{descricao}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
        {mostrados.map((c) => (
          <div key={c.chave} className={`col-span-2 ${LARGURA[c.largura ?? 'meia']}`}>
            <label htmlFor={c.chave} className="text-[11px] font-medium text-muted-foreground">
              {c.rotulo}
            </label>
            {c.tipo === 'escolha' ? (
              <select
                id={c.chave}
                value={form[c.chave] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [c.chave]: e.target.value }))}
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:border-brand-500"
              >
                <option value="">—</option>
                {(c.opcoes ?? []).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>
                    {rotulo}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={c.chave}
                type={c.tipo === 'data' ? 'date' : c.tipo === 'email' ? 'email' : 'text'}
                inputMode={c.tipo === 'tel' || c.tipo === 'cpf' ? 'numeric' : undefined}
                value={form[c.chave] ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    [c.chave]: c.tipo === 'cpf' ? mascaraCpf(e.target.value) : e.target.value,
                  }))
                }
                className="mt-1"
              />
            )}
            {/*
              O ALERTA É DO CAMPO QUE MUDA A VIDA DA PESSOA. Hoje só o CPF tem
              um: ele é a chave de login, e trocar sem saber disso é ficar de
              fora do portal sem entender por quê.
            */}
            {c.alerta && (
              <p className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                {c.alerta}
              </p>
            )}
            {c.dica && !c.alerta && (
              <p className="mt-1 text-[10px] text-muted-foreground">{c.dica}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * ONDE A PESSOA TRABALHA — o dado que o sindicato mais precisa e menos tem.
 *
 * É por ele que se sabe de qual folha vem o desconto e com qual empregador
 * negociar. A lista enviada SUBSTITUI a gravada (é assim que se tira um emprego
 * que acabou), e o servidor herda de volta o que a equipe registrou no vínculo
 * — desconto em folha, quadro, lotação — para o filiado não apagar sem saber.
 */
function LocaisDeTrabalho({
  vinculos,
  setVinculos,
}: {
  vinculos: MeuVinculo[];
  setVinculos: (v: MeuVinculo[]) => void;
}) {
  const mudar = (i: number, campo: keyof MeuVinculo, valor: string) =>
    setVinculos(vinculos.map((v, j) => (j === i ? { ...v, [campo]: valor } : v)));

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <Briefcase className="h-3.5 w-3.5 text-brand-700 dark:text-brand-400" /> Onde você trabalha
      </h2>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        Pode ter mais de um. Se saiu de algum, é só remover.
      </p>

      {!vinculos.length ? (
        <p className="mt-4 text-xs text-muted-foreground">Nenhum local cadastrado.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {vinculos.map((v, i) => (
            <li key={i} className="rounded-xl border bg-muted/20 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <div className="col-span-2 sm:col-span-6">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Instituição / Empresa
                  </label>
                  <Input
                    value={v.empresa}
                    onChange={(e) => mudar(i, 'empresa', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <label className="text-[11px] font-medium text-muted-foreground">Cargo</label>
                  <Input
                    value={v.cargo ?? ''}
                    onChange={(e) => mudar(i, 'cargo', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Matrícula no trabalho
                  </label>
                  <Input
                    value={v.matricula ?? ''}
                    onChange={(e) => mudar(i, 'matricula', e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVinculos(vinculos.filter((_, j) => j !== i))}
                className="mt-2 flex items-center gap-1 text-[11px] font-medium text-rose-700 transition-colors hover:underline dark:text-rose-400"
              >
                <Trash2 className="h-3 w-3" /> Não trabalho mais aqui
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={() => setVinculos([...vinculos, { empresa: '', cargo: '', matricula: '' }])}
      >
        <Plus className="h-3.5 w-3.5" /> Adicionar local de trabalho
      </Button>
    </section>
  );
}

/**
 * O QUE SÓ A SECRETARIA MUDA — e por quê, dito na tela.
 *
 * Um bloco cinza com cadeado e nenhuma explicação faz a pessoa ligar
 * perguntando. A frase abaixo responde antes da ligação.
 */
function SoLeitura({ cadastro }: { cadastro: MeuCadastro }) {
  const linhas: Array<[string, string | null]> = [
    ['Matrícula no sindicato', cadastro.matricula],
    ['Situação', cadastro.situacao === 'ATIVO' ? 'Ativo' : 'Inativo'],
    [`${V.Filiado} desde`, cadastro.dataFiliacao ? formatDataPura(cadastro.dataFiliacao) : null],
    [
      'Dependentes',
      cadastro.dependentes.length
        ? `${cadastro.dependentes.length} cadastrado(s)`
        : 'Nenhum cadastrado',
    ],
  ];

  return (
    <section className="rounded-2xl border bg-muted/30 p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" /> Só a secretaria altera
      </h2>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        Sua filiação e seus dependentes passam pela secretaria do {tenant.sigla}. Se algo estiver
        errado, fale com eles.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-xs sm:grid-cols-4">
        {linhas
          .filter(([, v]) => !!v)
          .map(([rotulo, valor]) => (
            <div key={rotulo} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {rotulo}
              </dt>
              <dd className={cn('mt-0.5 truncate font-medium')}>{valor}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
