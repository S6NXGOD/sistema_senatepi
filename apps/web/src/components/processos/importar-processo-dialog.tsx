'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Search, Loader2, User, Gavel, Landmark, Scale, Building2,
  CheckCircle2, AlertTriangle, ShieldAlert, Sparkles, Tag, Users, PenLine, Plus,
  ChevronRight,
} from 'lucide-react';
import { EtiquetasInput } from './etiquetas-input';
import { SeletorAdvogados } from './seletor-advogados';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import {
  formatDocumento, listarPartesExternas, TIPO_PARTE_LABEL, partesParecidas,
  MOTIVO_SEMELHANCA_LABEL, type ParteExterna, type ParteParecida,
} from '@/lib/partes';
import { cn } from '@/lib/utils';
import {
  importarProcesso, mascararNPU, consultarDatajud, sugerirAdvogado,
  aliasTribunalDoNPU, ORIGEM_SUGESTAO_LABEL,
  ProcessoDetalhe, ConsultaDatajud, SugestaoAdvogado, PoloAtivoInput,
} from '@/lib/processos';
import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';

/**
 * Como o polo ativo é preenchido. A escolha muda o que o formulário pede e o
 * que é gravado — e NENHUMA das opções cria cadastro provisório de filiado.
 */
type ModoPoloAtivo = 'INSTITUCIONAL' | 'FILIADOS' | 'OUTRA';

const OPCOES_POLO: { modo: ModoPoloAtivo; icone: typeof User; titulo: string; ajuda: string }[] = [
  {
    modo: 'INSTITUCIONAL',
    icone: Landmark,
    titulo: '🏛️ Ação Coletiva / Institucional',
    ajuda: `O ${tenant.sigla} move a ação em nome da categoria.`,
  },
  {
    modo: 'FILIADOS',
    icone: Users,
    titulo: `👤 Filiado(s) do ${tenant.sigla}`,
    ajuda: 'Um ou mais filiados já cadastrados.',
  },
  {
    modo: 'OUTRA',
    icone: PenLine,
    titulo: '✏️ Outra parte / Definir depois',
    ajuda: 'Digite o nome ou deixe em branco para resolver depois.',
  },
];

/** Linha rótulo/valor do painel de pré-visualização. */
function Linha({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  if (!valor) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="truncate font-medium" title={valor}>{valor}</dd>
    </div>
  );
}

// Validação: NPU precisa ter exatamente 20 dígitos (o backend também valida).
const schema = z.object({
  numeroCNJ: z
    .string()
    .refine((v) => v.replace(/\D/g, '').length === 20, 'Informe os 20 dígitos do número do processo.'),
  tribunal: z.string().optional(),
  advogadoId: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export function ImportarProcessoDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (p: ProcessoDetalhe) => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { numeroCNJ: '', tribunal: '', advogadoId: '' },
  });

  /**
   * POLO ATIVO. `FILIADOS` é o padrão porque é o caso mais comum (ação
   * individual de um associado); as outras duas são escolhas conscientes.
   */
  const [modoPolo, setModoPolo] = useState<ModoPoloAtivo>('FILIADOS');
  /** Litisconsórcio: vários filiados no mesmo polo, o 1º é o principal. */
  const [filiadosPolo, setFiliadosPolo] = useState<FiliadoBusca[]>([]);
  /** Nome da parte quando ela não é filiada (modo OUTRA). Nunca vira cadastro. */
  const [outraParteNome, setOutraParteNome] = useState('');

  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  /**
   * A EQUIPE INTEIRA, responsável incluído.
   *
   * Antes eram duas listas — `advogadoId` (o responsável) e `coAdvogados` (o
   * resto) — e mantê-las coerentes era trabalho de quem preenchia: dava para
   * marcar o mesmo advogado nos dois lugares. Agora é uma lista só, e o
   * responsável é apenas o item apontado por `advogadoId`.
   */
  const [equipeAdvogados, setEquipeAdvogados] = useState<string[]>([]);

  // Consulta prévia ao DataJud (auto-preenchimento). NÃO grava nada.
  const [previa, setPrevia] = useState<ConsultaDatajud | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  /**
   * Gatilho da consulta imediata (`onBlur` do NPU).
   *
   * São dois: o contador re-dispara o efeito, e o ref diz que ESTA execução
   * pula o debounce. Sem o ref, o primeiro blur deixaria todas as consultas
   * seguintes imediatas — e voltaríamos a bater no CNJ a cada tecla.
   */
  const [consultaImediata, setConsultaImediata] = useState(0);
  const semEspera = useRef(false);
  /** Último NPU efetivamente consultado — evita repetir a chamada no blur. */
  const ultimoConsultado = useRef('');
  /** Tribunal é fallback: só aparece quando alguém pede, ou quando a busca falha. */
  const [tribunalAberto, setTribunalAberto] = useState(false);
  const numeroDigitado = watch('numeroCNJ');
  const advogadoSelecionado = watch('advogadoId');
  /** Alias do tribunal derivado do NPU, ao vivo enquanto se digita. */
  const aliasTribunal = useMemo(() => aliasTribunalDoNPU(numeroDigitado ?? ''), [numeroDigitado]);
  /**
   * Filiado principal = o primeiro do polo. É ele que alimenta a sugestão de
   * advogado por histórico (a carteira costuma seguir o autor principal).
   */
  const filiadoSelecionado = modoPolo === 'FILIADOS' ? (filiadosPolo[0]?.id ?? '') : '';

  /**
   * Sugestões de advogado. Vêm de duas fontes que se somam: o DataJud (quando o
   * tribunal informa os advogados) e o histórico local do filiado selecionado —
   * esta última é consultada sem tocar no CNJ.
   */
  const [sugestoesDatajud, setSugestoesDatajud] = useState<SugestaoAdvogado[]>([]);
  const [etiquetas, setEtiquetas] = useState<string[]>([]);

  /**
   * Parte contrária (réu). Fica no formulário porque a API Pública do DataJud
   * NÃO devolve as partes do processo — confirmado nos índices de TJPI, TRT22,
   * TJSP e TRF1. Sem este campo, todo processo importado nasceria sem saber
   * contra quem se litiga.
   */
  const [reuSelecionado, setReuSelecionado] = useState<ParteExterna | null>(null);
  const [reuNome, setReuNome] = useState('');
  const [buscaReu, setBuscaReu] = useState('');
  const [reusEncontrados, setReusEncontrados] = useState<ParteExterna[]>([]);
  const [buscandoReu, setBuscandoReu] = useState(false);
  /** Cadastros que podem ser o réu que está sendo digitado à mão. */
  const [reusParecidos, setReusParecidos] = useState<ParteParecida[]>([]);
  const sugestoesHistorico = useQuery({
    queryKey: ['sugestao-advogado', filiadoSelecionado],
    queryFn: () => sugerirAdvogado(filiadoSelecionado as string),
    enabled: open && !!filiadoSelecionado,
  });

  const sugestoes = useMemo(() => {
    const mapa = new Map<string, SugestaoAdvogado>();
    for (const s of [...sugestoesDatajud, ...(sugestoesHistorico.data ?? [])]) {
      const atual = mapa.get(s.advogado.id);
      if (!atual || s.confianca > atual.confianca) mapa.set(s.advogado.id, s);
    }
    return [...mapa.values()].sort((a, b) => b.confianca - a.confianca);
  }, [sugestoesDatajud, sugestoesHistorico.data]);

  useEffect(() => {
    if (open) return;
    // Ao fechar, zera tudo.
    reset({ numeroCNJ: '', tribunal: '', advogadoId: '' });
    setModoPolo('FILIADOS');
    setFiliadosPolo([]);
    setOutraParteNome('');
    setEquipeAdvogados([]);
    setBusca('');
    setResultados([]);
    setPrevia(null);
    setErroPrevia(null);
    setSugestoesDatajud([]);
    setEtiquetas([]);
    setReuSelecionado(null);
    setReuNome('');
    setBuscaReu('');
    setReusEncontrados([]);
    setReusParecidos([]);
    setTribunalAberto(false);
  }, [open, reset]);

  // Autocomplete do cadastro de partes (a empresa ré que já processamos antes).
  useEffect(() => {
    const termo = buscaReu.trim();
    if (!open || termo.length < 2) { setReusEncontrados([]); return; }
    setBuscandoReu(true);
    const t = setTimeout(async () => {
      try { setReusEncontrados((await listarPartesExternas({ busca: termo, pageSize: 6 })).items); }
      catch { setReusEncontrados([]); }
      finally { setBuscandoReu(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [buscaReu, open]);

  /**
   * O RÉU DIGITADO À MÃO JÁ EXISTE NO CADASTRO?
   *
   * Este campo é o caminho rápido — digitar "PRONTOCARE" e seguir em frente — e
   * é justamente ele que cria duplicata: o autocomplete acima só encontra quem
   * digita MENOS do que está gravado, então quem escreve a razão social
   * completa não vê o apelido já cadastrado. Aqui a comparação é por palavra,
   * nos dois sentidos, e o resultado aparece antes de importar.
   *
   * Avisa, nunca bloqueia: pode ser outra empresa com nome parecido, e quem
   * está com o processo na mão sabe.
   */
  useEffect(() => {
    const termo = reuNome.trim();
    if (!open || reuSelecionado || termo.length < 3) { setReusParecidos([]); return; }
    const t = setTimeout(async () => {
      try { setReusParecidos(await partesParecidas(termo)); }
      catch { setReusParecidos([]); }
    }, 400);
    return () => clearTimeout(t);
  }, [reuNome, reuSelecionado, open]);

  // Dispara a consulta assim que os 20 dígitos estiverem completos (com debounce
  // para não bater no CNJ a cada tecla).
  useEffect(() => {
    const digitos = (numeroDigitado ?? '').replace(/\D/g, '');
    if (!open || digitos.length !== 20) {
      setPrevia(null);
      setErroPrevia(null);
      return;
    }
    // Sair e voltar ao campo sem mudar o número não consulta de novo: o CNJ tem
    // cota, e a resposta que está na tela é a mesma.
    const imediata = semEspera.current;
    semEspera.current = false;
    if (imediata && ultimoConsultado.current === digitos) return;

    let cancelado = false;
    setConsultando(true);
    setErroPrevia(null);
    // Digitando: 600ms de espera para não bater no CNJ a cada tecla. Saindo do
    // campo (`onBlur`), a intenção já está clara — vai na hora.
    const t = setTimeout(async () => {
      ultimoConsultado.current = digitos;
      try {
        const r = await consultarDatajud(digitos);
        if (cancelado) return;
        setPrevia(r);
        // Filiado localizado pelo CPF de uma das partes → entra no polo ativo,
        // sem apagar quem o operador já tenha escolhido à mão.
        if (r.filiadoSugerido) {
          const sug = r.filiadoSugerido;
          setModoPolo('FILIADOS');
          setFiliadosPolo((atuais) =>
            atuais.some((f) => f.id === sug.id)
              ? atuais
              : [...atuais, { id: sug.id, nome: sug.nomeCompleto, cpfMascarado: '' } as FiliadoBusca],
          );
        }
        if (r.preenchimento?.tribunal) setValue('tribunal', r.preenchimento.tribunal);
        /**
         * NÃO PRÉ-PREENCHE MAIS ETIQUETA. Coletiva, Perícia, fase de execução e
         * recurso o sistema deduz sozinho dos dados do processo, a cada leitura
         * — sugerir aqui só criava um texto que congelava enquanto o processo
         * andava. O campo de etiquetas ficou para o que depende de julgamento
         * humano (Urgente, Acordo, Aguardando Cliente).
         */
        // Não achou no tribunal deduzido? Aí sim o campo manual importa — abre
        // sozinho, em vez de deixar a pessoa procurando o que fazer.
        if (!r.encontrado) setTribunalAberto(true);
        const sugs = r.sugestoesAdvogado ?? [];
        setSugestoesDatajud(sugs);
        // Pré-seleção automática só com indício FORTE (match de OAB, que é
        // identificador único). Nome parecido fica apenas sugerido — o operador
        // decide. E nunca sobrescrevemos uma escolha já feita.
        const forte = sugs.find((s) => s.origem === 'DATAJUD_OAB');
        if (forte && !watch('advogadoId')) {
          setValue('advogadoId', forte.advogado.id);
          setEquipeAdvogados((ids) => (ids.includes(forte.advogado.id) ? ids : [...ids, forte.advogado.id]));
        }
      } catch (e: any) {
        if (!cancelado) {
          setPrevia(null);
          setErroPrevia(e?.response?.data?.message ?? 'Não foi possível consultar o DataJud agora.');
          // Falhou: esquece o número consultado para que sair e voltar ao campo
          // tente de novo, em vez de repetir o erro parado na tela.
          ultimoConsultado.current = '';
        }
      } finally {
        if (!cancelado) setConsultando(false);
      }
    }, imediata ? 0 : 600);
    return () => { cancelado = true; clearTimeout(t); };
  }, [numeroDigitado, open, setValue, consultaImediata]);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        setResultados(await buscarFiliados(termo));
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  /** Traduz a escolha da tela para o contrato da API. */
  function montarPoloAtivo(): PoloAtivoInput {
    if (modoPolo === 'INSTITUCIONAL') return { tipo: 'INSTITUCIONAL' };
    if (modoPolo === 'FILIADOS') return { tipo: 'FILIADOS', filiadoIds: filiadosPolo.map((f) => f.id) };
    // OUTRA: nome digitado, ou nada ("definir depois") — a API aceita vazio.
    return { tipo: 'OUTRA', nome: outraParteNome.trim() || undefined };
  }

  const importar = useMutation({
    mutationFn: (data: FormData) =>
      importarProcesso({
        numeroCNJ: data.numeroCNJ.replace(/\D/g, ''),
        tribunal: data.tribunal?.trim() || undefined,
        poloAtivo: montarPoloAtivo(),
        advogadoId: data.advogadoId || undefined,
        advogadosIds: equipeAdvogados.length ? equipeAdvogados : undefined,
        etiquetas: etiquetas.length ? etiquetas : undefined,
        // Réu: o DataJud não devolve as partes, então este é o único momento
        // barato de capturá-lo — depois vira tarefa na fila "Sem réu cadastrado".
        ...(reuSelecionado || reuNome.trim()
          ? {
              parteContraria: reuSelecionado
                ? { parteExternaId: reuSelecionado.id }
                : { nome: reuNome.trim() },
            }
          : {}),
      }),
    onSuccess: (p) => {
      toast.success('Processo importado do DATAJUD.');
      onImported(p);
      onClose();
    },
    onError: (e: any) => {
      const status = e?.response?.status;
      const msg =
        e?.response?.data?.message ??
        (status === 409
          ? 'Este processo já foi importado.'
          : 'Não foi possível importar o processo.');
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    },
  });

  function adicionarFiliado(f: FiliadoBusca) {
    setFiliadosPolo((atuais) => (atuais.some((x) => x.id === f.id) ? atuais : [...atuais, f]));
    setBusca('');
    setResultados([]);
  }
  function removerFiliado(id: string) {
    setFiliadosPolo((atuais) => atuais.filter((f) => f.id !== id));
  }

  /**
   * O botão de importar só trava quando falta algo que a API vai recusar:
   * em FILIADOS, ao menos um filiado. As outras duas opções podem seguir vazias
   * — "definir depois" é uma escolha legítima.
   */
  const poloValido = modoPolo !== 'FILIADOS' || filiadosPolo.length > 0;

  /**
   * ESC fecha. O drawer trazia isso de graça; num modal próprio é nosso.
   * (O Enter para enviar é comportamento nativo do form — o cuidado necessário
   * está nos campos de BUSCA, onde Enter significa "procurar", não "importar":
   * eles interceptam a tecla logo abaixo.)
   */
  useEffect(() => {
    if (!open) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', aoTeclar);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = anterior;
    };
  }, [open, onClose]);

  /** Enter num campo de busca não pode enviar o formulário meio preenchido. */
  const enterNaoEnvia = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      {/* DUAS COLUNAS. No drawer de 448px, os cinco blocos do formulário viravam
          uma fita de rolagem de quase três telas: quem preenchia o polo ativo já
          não via o número que digitou. Aqui a identificação fica à esquerda e as
          partes à direita, lado a lado — e no celular tudo volta a empilhar. */}
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
      <div className="flex items-center justify-between border-b p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <Gavel className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Importar processo</h3>
            <p className="text-sm text-muted-foreground">Consulta direta ao DATAJUD (CNJ)</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit((d) => importar.mutate(d))} className="flex flex-1 flex-col overflow-hidden">
        <div className="grid flex-1 gap-x-6 gap-y-4 overflow-y-auto p-5 md:grid-cols-2 md:items-start">
          {/* ================= COLUNA 1 — IDENTIFICAÇÃO E ATRIBUIÇÃO ================= */}
          <div className="space-y-4">
          {/* NPU com máscara automática */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Número do Processo (NPU) *</label>
            <Controller
              control={control}
              name="numeroCNJ"
              render={({ field }) => (
                <Input
                  inputMode="numeric"
                  autoFocus
                  placeholder="0000000-00.0000.0.00.0000"
                  value={field.value}
                  onChange={(e) => field.onChange(mascararNPU(e.target.value))}
                  // Sair do campo consulta na hora, sem esperar o debounce: quem
                  // COLA o número já terminou de digitar, e meio segundo de
                  // espera com o cursor parado parece travamento.
                  onBlur={() => { semEspera.current = true; setConsultaImediata((n) => n + 1); }}
                  className="font-mono tracking-tight"
                />
              )}
            />
            {errors.numeroCNJ && <p className="text-xs text-red-600">{errors.numeroCNJ.message}</p>}
            {/* Alias derivado do próprio NPU, sem ida ao servidor — aparece
                assim que os dígitos do segmento/tribunal são digitados. */}
            {aliasTribunal ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Landmark className="h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-400" />
                Tribunal identificado:{' '}
                <strong className="font-semibold text-brand-800 dark:text-brand-400">
                  {aliasTribunal}
                </strong>
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                O tribunal é identificado automaticamente pelo número.
              </p>
            )}
          </div>

          {/* ---- Auto-preenchimento a partir do DataJud ---- */}
          {consultando && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Consultando o DataJud (pode levar até 30s)…
            </div>
          )}

          {erroPrevia && !consultando && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              {erroPrevia} Você ainda pode importar — a busca será refeita ao salvar.
            </div>
          )}

          {previa && !consultando && (
            previa.encontrado && previa.preenchimento ? (
              <div className="space-y-2 rounded-xl border border-brand-400/60 bg-brand-50/50 p-3 dark:bg-brand-900/10">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-800 dark:text-brand-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Processo localizado no{' '}
                  {previa.preenchimento.tribunal}
                </p>
                <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
                  <Linha rotulo="Ação/Classe" valor={previa.preenchimento.classeProcessual} />
                  <Linha rotulo="Vara" valor={previa.preenchimento.orgaoJulgador} />
                  <Linha rotulo="Tribunal" valor={`${previa.preenchimento.tribunal}${previa.preenchimento.grau ? ` · ${previa.preenchimento.grau}` : ''}`} />
                  <Linha rotulo="Distribuição" valor={previa.preenchimento.dataDistribuicao ? new Date(previa.preenchimento.dataDistribuicao).toLocaleDateString('pt-BR') : null} />
                  <Linha rotulo="Assunto" valor={previa.preenchimento.assuntoPrincipal} />
                  <Linha rotulo="Formato" valor={[previa.preenchimento.formato, previa.preenchimento.sistema].filter(Boolean).join(' · ') || null} />
                </dl>
                <p className="text-[11px] text-muted-foreground">
                  {previa.preenchimento.totalMovimentacoes} movimentação(ões) serão importadas.
                  {previa.preenchimento.ultimaMovimentacao && (
                    <> Última: <strong>{previa.preenchimento.ultimaMovimentacao.descricao}</strong>
                      {previa.preenchimento.ultimaMovimentacao.detalhe ? ` — ${previa.preenchimento.ultimaMovimentacao.detalhe}` : ''}.</>
                  )}
                </p>
                {previa.preenchimento.segredoJustica && (
                  <p className="flex items-center gap-1.5 rounded-md bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    <ShieldAlert className="h-3.5 w-3.5" /> Segredo de Justiça — acesso restrito.
                  </p>
                )}
                {/* Partes do processo (quando o tribunal expõe) */}
                {(previa.polos?.ativo?.length || previa.polos?.passivo?.length) ? (
                  <div className="space-y-1 rounded-md bg-card p-2">
                    {previa.polos!.ativo.length > 0 && (
                      <p className="text-[11px]">
                        <span className="text-muted-foreground">Polo Ativo:</span>{' '}
                        <strong>{previa.polos!.ativo.map((p) => p.nome ?? '—').join(', ')}</strong>
                      </p>
                    )}
                    {previa.polos!.passivo.length > 0 && (
                      <p className="text-[11px]">
                        <span className="text-muted-foreground">Polo Passivo:</span>{' '}
                        <strong>{previa.polos!.passivo.map((p) => p.nome ?? '—').join(', ')}</strong>
                      </p>
                    )}
                  </div>
                ) : null}

                {previa.jaImportado && (
                  <p className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    Este processo já está cadastrado. Use "Sincronizar" no detalhe para atualizar.
                  </p>
                )}

                {/* Vínculo de filiado. Numa ação institucional não há filiado
                    "dono" — cobrar o vínculo ali seria ruído, não alerta. */}
                {modoPolo === 'INSTITUCIONAL' ? null : previa.filiadoSugerido ? (
                  <p className="flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {V.Filiado} localizado pelo CPF: <strong>{previa.filiadoSugerido.nomeCompleto}</strong> — já adicionado ao polo ativo.
                  </p>
                ) : (
                  /* NÃO É ALERTA. A API pública do CNJ não devolve as partes —
                     por regra do próprio CNJ, em todos os tribunais. Então este
                     aviso aparecia amarelo em TODA importação, avisando de algo
                     que nunca vai ser diferente. Alarme que sempre soa é alarme
                     que ninguém lê. Virou o que sempre foi: uma explicação. */
                  <p className="rounded-md bg-muted px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                    {previa.tribunalNaoExpoePartes
                      ? 'O CNJ não divulga as partes na API pública — quem move a ação e contra quem é você que informa, ao lado.'
                      : 'Nenhuma das partes informadas pelo tribunal bate com um filiado cadastrado — informe ao lado quem é o polo ativo.'}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" /> Não localizado na base pública do CNJ
                  {previa.tribunalDerivado ? ` (${previa.tribunalDerivado})` : ''}
                </p>
                {/* HONESTIDADE COM O OPERADOR: sem o processo no DataJud, a
                    importação FALHA — a API recusa. Prometer "importe assim
                    mesmo" faria a pessoa perder o preenchimento inteiro num
                    erro. As saídas reais são conferir o número e conferir a
                    sigla; se nem assim, o tribunal ainda não alimentou a base
                    do CNJ e não há o que importar hoje. */}
                <p className="text-amber-800/80 dark:text-amber-300/80">
                  Confira o número — e, se estiver certo, defina a sigla do tribunal à mão logo
                  abaixo. A importação depende de o tribunal já ter enviado o processo ao CNJ.
                </p>
              </div>
            )
          )}

          {/* Advogado responsável (opcional) — com sugestão facultativa */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Scale className="h-4 w-4 text-muted-foreground" /> Advogado(s) do processo (opcional)
            </label>

            {/* Sugestões: aceitar é 1 clique; ignorar é só não clicar. */}
            {sugestoes.length > 0 && (
              <div className="space-y-1.5">
                {sugestoes.slice(0, 2).map((s) => {
                  const jaSelecionado = advogadoSelecionado === s.advogado.id;
                  return (
                    <button
                      key={s.advogado.id}
                      type="button"
                      onClick={() => {
                        // Aceitar a sugestão coloca a pessoa NA EQUIPE e como
                        // responsável — antes ela virava responsável sem entrar
                        // na equipe, e a lista de baixo não a mostrava.
                        if (jaSelecionado) {
                          setValue('advogadoId', '');
                          setEquipeAdvogados((ids) => ids.filter((x) => x !== s.advogado.id));
                        } else {
                          setValue('advogadoId', s.advogado.id);
                          setEquipeAdvogados((ids) => (ids.includes(s.advogado.id) ? ids : [...ids, s.advogado.id]));
                        }
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition',
                        jaSelecionado
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                          : 'border-dashed border-brand-400/60 hover:bg-muted/50',
                      )}
                    >
                      <Sparkles className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {s.advogado.nomeExibicao || s.advogado.nome}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">{s.motivo}</span>
                      </span>
                      <span className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        jaSelecionado
                          ? 'bg-brand-800 text-white'
                          : 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-400',
                      )}>
                        {jaSelecionado ? 'Selecionado' : ORIGEM_SUGESTAO_LABEL[s.origem]}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <SeletorAdvogados
              valor={{ ids: equipeAdvogados, principal: advogadoSelecionado ?? '' }}
              onChange={({ ids, principal }) => {
                setEquipeAdvogados(ids);
                setValue('advogadoId', principal);
              }}
              vazioLabel="Selecionar advogado(s)…"
            />
            <p className="text-[11px] text-muted-foreground">
              Pode marcar mais de um — a estrela define quem responde pelo processo. Deixar em
              branco também é válido: o vínculo pode ser feito depois.
            </p>
          </div>

          {/* Etiquetas internas */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Tag className="h-4 w-4 text-muted-foreground" /> Etiquetas (opcional)
            </label>
            <EtiquetasInput valor={etiquetas} onChange={setEtiquetas} />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Só o que depende de julgamento seu. Ação coletiva, perícia, fase de execução e recurso
              o sistema deduz sozinho dos dados do processo.
            </p>
          </div>

          {/* TRIBUNAL — fallback, e só.
              O campo ficava aberto em todo formulário sugerindo que era preciso
              preencher, quando em 99% dos casos a sigla sai do próprio número.
              Ele só importa quando o NPU não permite deduzi-la (Justiça
              Eleitoral) ou quando a busca falhou no tribunal deduzido. */}
          <div className="space-y-1.5">
            {!tribunalAberto ? (
              <button
                type="button"
                onClick={() => setTribunalAberto(true)}
                className="flex items-center gap-1 text-[11px] font-medium text-brand-800 hover:underline dark:text-brand-400"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                Não encontrou o tribunal automaticamente? Defina a sigla à mão
              </button>
            ) : (
              <>
                <label className="flex items-center gap-1.5 text-sm font-medium">
                  <Landmark className="h-4 w-4 text-muted-foreground" /> Tribunal (opcional)
                </label>
                <Input placeholder="Ex.: TJPI, TRF1, TRT22" className="uppercase" {...register('tribunal')} />
                <p className="text-[11px] text-muted-foreground">
                  Só é necessário quando o tribunal não pode ser derivado do NPU (ex.: Justiça Eleitoral).
                </p>
              </>
            )}
          </div>

          </div>

          {/* ================= COLUNA 2 — PARTES DO PROCESSO ================= */}
          <div className="space-y-4">
          {/* ---- POLO ATIVO: quem move a ação ---- */}
          <div className="space-y-2 rounded-xl border p-3">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <User className="h-4 w-4 text-muted-foreground" /> Polo Ativo (autor/representado) *
            </label>

            <div className="grid grid-cols-1 gap-1.5">
              {OPCOES_POLO.map((o) => {
                const ativo = modoPolo === o.modo;
                return (
                  <button
                    key={o.modo}
                    type="button"
                    onClick={() => setModoPolo(o.modo)}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border p-2.5 text-left transition',
                      ativo
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                        : 'hover:bg-muted/50',
                    )}
                  >
                    <o.icone
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        ativo ? 'text-brand-700 dark:text-brand-400' : 'text-muted-foreground',
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{o.titulo}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">{o.ajuda}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* --- Institucional: nada a preencher, só a confirmação visual --- */}
            {modoPolo === 'INSTITUCIONAL' && (
              <div className="rounded-lg border border-brand-400/60 bg-brand-50/60 px-3 py-2 dark:bg-brand-900/10">
                <p className="text-xs font-semibold text-brand-800 dark:text-brand-400">
                  🏛️ Ação Institucional ({tenant.sigla})
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  O sindicato entra como autor. O processo é marcado como coletivo e não cobra
                  filiado vinculado.
                </p>
              </div>
            )}

            {/* --- Filiados: busca e lista (litisconsórcio) --- */}
            {modoPolo === 'FILIADOS' && (
              <div className="space-y-2">
                {filiadosPolo.length > 0 && (
                  <ul className="space-y-1.5">
                    {filiadosPolo.map((f, i) => (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{f.nome}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {i === 0 ? 'Autor principal' : 'Litisconsorte'}
                            {f.cpfMascarado ? ` · ${f.cpfMascarado}` : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removerFiliado(f.id)}
                          title="Remover do polo"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder={filiadosPolo.length ? 'Adicionar outro filiado…' : 'Buscar por nome ou CPF…'}
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={enterNaoEnvia}
                  />
                  {buscando && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                  {resultados.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-card shadow-lg">
                      {resultados.map((f) => {
                        const jaNoPolo = filiadosPolo.some((x) => x.id === f.id);
                        return (
                          <li key={f.id}>
                            <button
                              type="button"
                              disabled={jaNoPolo}
                              onClick={() => adicionarFiliado(f)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                            >
                              {jaNoPolo ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                              ) : (
                                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{f.nome}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {f.cpfMascarado}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {filiadosPolo.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Selecione ao menos um filiado — ou troque para “Outra parte / Definir depois”.
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    O primeiro da lista é o autor principal. Vincular o filiado permite revelar o
                    CPF dele nas partes (máscara inteligente).
                  </p>
                )}
              </div>
            )}

            {/* --- Outra parte: só o nome, e nunca um cadastro novo --- */}
            {modoPolo === 'OUTRA' && (
              <div className="space-y-1.5">
                <Input
                  placeholder="Nome da parte (opcional)"
                  value={outraParteNome}
                  onChange={(e) => setOutraParteNome(e.target.value)}
                />
                {/* Escolha consciente de quem está preenchendo — não há por que
                    devolver um alerta amarelo confirmando o que ele acabou de
                    clicar. Fica só a consequência prática. */}
                <p className="rounded-md bg-muted px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                  Nenhum cadastro de filiado será criado. Dá para vincular um depois, na aba
                  <strong className="font-semibold text-foreground"> Partes</strong> do processo.
                </p>
              </div>
            )}
          </div>

          {/* Parte contrária (réu) — o dado que o DataJud não entrega */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Building2 className="h-4 w-4 text-muted-foreground" /> Parte contrária / réu (opcional)
            </label>

            {reuSelecionado ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{reuSelecionado.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {TIPO_PARTE_LABEL[reuSelecionado.tipo]}
                    {reuSelecionado.documento ? ` · ${formatDocumento(reuSelecionado.documento)}` : ''}
                  </span>
                </span>
                <button type="button" onClick={() => setReuSelecionado(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Buscar empresa/órgão já cadastrado…"
                    value={buscaReu}
                    onChange={(e) => setBuscaReu(e.target.value)}
                    onKeyDown={enterNaoEnvia}
                  />
                  {buscandoReu && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                  {reusEncontrados.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-input bg-card shadow-lg">
                      {reusEncontrados.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => { setReuSelecionado(r); setBuscaReu(''); setReusEncontrados([]); setReuNome(''); }}
                            className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                          >
                            <span className="font-medium">{r.nome}</span>
                            <span className="text-xs text-muted-foreground">
                              {TIPO_PARTE_LABEL[r.tipo]}
                              {r._count ? ` · ${r._count.participacoes} processo(s)` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Input
                  placeholder="…ou digite o nome do réu (ex.: PRONTOCARE)"
                  value={reuNome}
                  onChange={(e) => setReuNome(e.target.value)}
                />

                {/* Aviso amigável: mostra o que já existe e deixa reaproveitar
                    com um clique, em vez de recusar o que a pessoa digitou. */}
                {reusParecidos.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Pode ser que esta parte já esteja cadastrada
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-800/80 dark:text-amber-300/80">
                      Reaproveitar mantém todos os processos contra a mesma empresa juntos.
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {reusParecidos.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => { setReuSelecionado(c); setReuNome(''); setReusParecidos([]); }}
                            className="flex w-full items-center gap-2 rounded bg-card px-2 py-1.5 text-left transition hover:bg-muted"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{c.nome}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {MOTIVO_SEMELHANCA_LABEL[c.motivo]} · {TIPO_PARTE_LABEL[c.tipo]}
                                {c._count ? ` · ${c._count.participacoes} processo(s)` : ''}
                              </span>
                            </span>
                            <span className="shrink-0 text-[11px] font-medium text-brand-800 dark:text-brand-400">
                              usar esta
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            <p className="text-[11px] text-muted-foreground">
              A API Pública do DataJud <strong>não divulga as partes</strong> do processo — este dado é
              da casa. Informe agora ou depois, na aba "Partes".
            </p>
          </div>

          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 p-4">
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            <kbd className="rounded border bg-card px-1 font-mono">Enter</kbd> importa ·{' '}
            <kbd className="rounded border bg-card px-1 font-mono">Esc</kbd> fecha
          </p>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={importar.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={importar.isPending || !poloValido}>
              {importar.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando no Tribunal…
                </>
              ) : (
                <>
                  <Gavel className="h-4 w-4" /> Importar processo
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}
