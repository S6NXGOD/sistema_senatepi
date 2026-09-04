'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Search, Loader2, Gavel, Landmark, Scale, Building2,
  CheckCircle2, AlertTriangle, ShieldAlert, Sparkles, Tag, Users,
  ChevronRight, UserPlus, UserCheck, Star,
} from 'lucide-react';
import { CadastroFiliadoModal } from '@/components/filiados/cadastro-filiado-modal';
import { usePodeCadastrarFiliado } from '@/components/filiados/permissao-cadastro';
import { RecadastrarModal } from '@/components/filiados/recadastrar-modal';
import { EditorDePartes, jaEstaNaLista, type ParteEditavel } from './editor-de-partes';
import { EtiquetasInput } from './etiquetas-input';
import { SeletorAdvogados } from './seletor-advogados';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { buscarFiliados } from '@/lib/colonia';
import {
  formatDocumento, listarPartesExternas, TIPO_PARTE_LABEL, partesParecidas,
  MOTIVO_SEMELHANCA_LABEL, type ParteParecida,
} from '@/lib/partes';
import { cn } from '@/lib/utils';
import {
  importarProcesso, mascararNPU, consultarDatajud, sugerirAdvogado,
  aliasTribunalDoNPU, ORIGEM_SUGESTAO_LABEL,
  ProcessoDetalhe, ConsultaDatajud, SugestaoAdvogado, PoloAtivoInput,
} from '@/lib/processos';
import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';

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
   * O POLO ATIVO COMO UMA RELAÇÃO, e não como um modo escolhido.
   *
   * Filiado, o próprio sindicato e parte sem cadastro convivem na mesma lista,
   * na ordem em que forem postos — o primeiro é o autor principal. Nenhuma das
   * opções cria cadastro provisório de filiado: o nome livre é só o snapshot
   * de como a parte consta nos autos.
   */
  const [poloAtivo, setPoloAtivo] = useState<ParteEditavel[]>([]);

  /** Cadastro completo por cima do formulário, sem perder o que já foi digitado. */
  const [cadastrando, setCadastrando] = useState(false);
  /** O nome digitado na busca, para o cadastro não começar em branco. */
  const [nomeParaCadastro, setNomeParaCadastro] = useState('');
  /** Recadastramento de quem já está no polo — presencial ou por link. */
  const [recadastrar, setRecadastrar] = useState<{ id: string; nome: string } | null>(null);
  /** Recadastro PRESENCIAL: abre o formulário completo por cima, sem navegar. */
  const [filiadoParaRecadastro, setFiliadoParaRecadastro] = useState<string | null>(null);
  const podeCadastrarFiliado = usePodeCadastrarFiliado();

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
  const filiadoSelecionado = poloAtivo.find((x) => x.filiadoId)?.filiadoId ?? '';

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
  /**
   * O LITISCONSÓRCIO PASSIVO — mesma relação, mesma regra do polo ativo.
   *
   * NÃO EXISTE MAIS "RÉU EM EDIÇÃO". Havia três estados para uma coisa só (a
   * lista, o escolhido no cadastro e o digitado à mão), e o botão
   * "Acrescentar outro réu" nem era necessário — o réu em edição já ia no
   * envio. Quem clicava nele via o nome pular para a lista e o campo esvaziar,
   * com o aviso de parecidos ainda na tela convidando a repetir.
   */
  const [reus, setReus] = useState<ParteEditavel[]>([]);
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
    setPoloAtivo([]);
    setEquipeAdvogados([]);
    setNomeParaCadastro('');
    setRecadastrar(null);
    setFiliadoParaRecadastro(null);
    setPrevia(null);
    setErroPrevia(null);
    setSugestoesDatajud([]);
    setEtiquetas([]);
    setReus([]);
    setTribunalAberto(false);
  }, [open, reset]);

  /**
   * A BUSCA DE RÉU — cadastro e "parecidos" na MESMA lista.
   *
   * Eram duas consultas mostradas em dois lugares: o autocomplete achava quem
   * digita MENOS do que está gravado, e um efeito à parte procurava, por
   * palavra, quem digita a razão social inteira — e despejava o resultado num
   * aviso amarelo abaixo do campo. Duas listas para a mesma pergunta, e a de
   * baixo continuava na tela depois de escolher.
   *
   * Agora as duas alimentam a mesma lista, e o motivo da semelhança vira o
   * detalhe da linha. Quem já está na relação continua aparecendo, marcado —
   * sumir faria parecer que a busca não achou a empresa.
   */
  async function buscarReus(termo: string): Promise<ParteEditavel[]> {
    const [{ items }, parecidas] = await Promise.all([
      listarPartesExternas({ busca: termo, pageSize: 8 }),
      termo.trim().length >= 3 ? partesParecidas(termo) : Promise.resolve([] as ParteParecida[]),
    ]);
    const vistos = new Set(items.map((r) => r.id));
    const doCadastro: ParteEditavel[] = items.map((r) => ({
      tipo: 'ORGANIZACAO',
      nome: r.nome,
      detalhe: [
        TIPO_PARTE_LABEL[r.tipo],
        r.documento ? formatDocumento(r.documento) : null,
        r._count ? `${r._count.participacoes} processo(s)` : null,
      ].filter(Boolean).join(' · '),
      parteExternaId: r.id,
    }));
    const semelhantes: ParteEditavel[] = parecidas
      .filter((c) => !vistos.has(c.id))
      .map((c) => ({
        tipo: 'ORGANIZACAO',
        nome: c.nome,
        detalhe: [
          MOTIVO_SEMELHANCA_LABEL[c.motivo],
          TIPO_PARTE_LABEL[c.tipo],
          c._count ? `${c._count.participacoes} processo(s)` : null,
        ].filter(Boolean).join(' · '),
        parteExternaId: c.id,
      }));
    return [...doCadastro, ...semelhantes];
  }

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
          adicionarFiliado({
            tipo: 'FILIADO',
            nome: sug.nomeCompleto,
            detalhe: `${V.filiado} · achado pelo CPF nos autos`,
            filiadoId: sug.id,
          });
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

  /**
   * Traduz a relação para o contrato da API — e manda os DOIS formatos.
   *
   * `partes` é o caminho novo (relação ordenada, tipos misturados). `tipo`
   * continua junto como RESUMO porque web e API sobem separadas no Railway: na
   * janela de troca, a tela nova conversa com o contêiner velho, que ignora
   * `partes`. Sem o resumo, toda importação feita nesse intervalo entraria com
   * o polo ativo VAZIO — sem erro na tela, só sem autor.
   */
  function montarPoloAtivo(): PoloAtivoInput {
    const partes = poloAtivo.map((x) => ({
      tipo: x.tipo,
      filiadoId: x.filiadoId,
      parteExternaId: x.parteExternaId,
      nome: x.nome,
    }));
    const filiadoIds = poloAtivo.map((x) => x.filiadoId).filter(Boolean) as string[];
    if (filiadoIds.length) return { tipo: 'FILIADOS', filiadoIds, partes };
    if (poloAtivo.some((x) => x.tipo === 'INSTITUCIONAL')) return { tipo: 'INSTITUCIONAL', partes };
    const avulsa = poloAtivo[0];
    return { tipo: 'OUTRA', nome: avulsa?.nome, partes };
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
        // RÉUS: a lista já montada mais o que estiver em edição. Enviar o
        // último sem exigir o clique em "adicionar" é o que evita a perda
        // silenciosa mais comum deste tipo de formulário.
        ...(reus.length
          ? {
              partesContrarias: reus.map((r) => ({
                parteExternaId: r.parteExternaId,
                nome: r.nome,
              })),
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

  /** Põe um filiado no polo, sem repetir quem já está lá. */
  function adicionarFiliado(p: ParteEditavel) {
    setPoloAtivo((atual) => (jaEstaNaLista(atual, p) ? atual : [...atual, p]));
  }

  /**
   * AVISA, NÃO TRAVA.
   *
   * Eu tinha travado o botão com polo ativo vazio, e isso era decisão minha:
   * "definir depois" é legítimo — quem está subindo acervo antigo nem sempre
   * sabe quem é a parte, e a aba Partes existe para isso. Trancar a porta
   * empurraria a pessoa para o pior caminho disponível, que é digitar qualquer
   * nome só para passar.
   *
   * O que fica é a CONSEQUÊNCIA dita na hora: sem parte, o processo entra na
   * fila "sem filiado vinculado". Quem lê isso e mesmo assim segue, seguiu
   * sabendo — e é diferente de descobrir depois numa fila de 29.
   */
  const poloVazio = poloAtivo.length === 0;

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
                {poloAtivo.some((x) => x.tipo === 'INSTITUCIONAL') ? null : previa.filiadoSugerido ? (
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
          {/* ---- POLO ATIVO: quem pede ---- */}
          <div className="space-y-2 rounded-xl border p-3">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Users className="h-4 w-4 text-muted-foreground" /> Polo ativo — quem pede *
            </label>

            {/*
              TRÊS BOTÕES EXCLUSIVOS VIRARAM UMA RELAÇÃO.

              Era "Filiado(s)" OU "Ação institucional" OU, num link abaixo, "a
              parte não é o sindicato nem um filiado" — e escolher um apagava a
              tela do outro. A realidade não é exclusiva: existe ação em que o
              sindicato entra AO LADO do filiado, e existe litisconsórcio com
              outro sindicato.

              Agora é uma lista só: procure o filiado, ou acrescente o
              {' '}{tenant.sigla}, ou digite um nome que não está em lugar nenhum.
              Os três convivem, e a ordem diz quem é o principal.
            */}
            <EditorDePartes
              partes={poloAtivo}
              onChange={setPoloAtivo}
              placeholder={`Nome ou CPF do ${V.filiado}…`}
              rotuloPrincipal="Autor principal"
              rotuloSecundario="Litisconsorte"
              permitirTextoLivre
              vazio={`Quem está pedindo? Procure o ${V.filiado} pelo nome ou CPF — ou acrescente o ${tenant.sigla}, se a ação é da categoria.`}
              buscar={async (termo) => {
                const achados = await buscarFiliados(termo);
                return achados.map((f) => ({
                  tipo: 'FILIADO' as const,
                  nome: f.nome,
                  detalhe: [V.filiado, f.cpfMascarado].filter(Boolean).join(' · '),
                  filiadoId: f.id,
                }));
              }}
              acoes={[
                {
                  /* Sempre visível: a ação coletiva não tem nome para procurar. */
                  exigeTermo: false,
                  icone: Landmark,
                  rotulo: () => `Ação da categoria — acrescentar o ${tenant.sigla}`,
                  aoEscolher: () =>
                    setPoloAtivo((atual) =>
                      atual.some((x) => x.tipo === 'INSTITUCIONAL')
                        ? atual
                        : [...atual, {
                            tipo: 'INSTITUCIONAL',
                            nome: tenant.nome,
                            detalhe: 'O próprio sindicato',
                          }],
                    ),
                },
                ...(podeCadastrarFiliado
                  ? [{
                      /*
                        O BOTÃO DE CADASTRAR MORA DENTRO DA LISTA.

                        Ele existia num painel logo abaixo do campo — e a lista
                        de resultados, que é `absolute`, passava POR CIMA dele.
                        O botão estava na tela e ficava atrás de uma caixa
                        branca; foi o que o usuário viu.
                      */
                      icone: UserPlus,
                      rotulo: (t: string) => `Cadastrar “${t}” como ${V.filiado}`,
                      aoEscolher: (t: string) => { setNomeParaCadastro(t); setCadastrando(true); },
                    }]
                  : []),
              ]}
              extraDaLinha={(parte) =>
                /*
                  O BOTÃO SÓ APARECE PARA QUEM A API DEIXA USAR.

                  `POST /filiados/:id/link-recadastramento` e
                  `PATCH /filiados/:id/atualizacao-cadastral` são
                  ADMINISTRADOR/COORDENAÇÃO/TRIAGEM — o ADVOGADO tem
                  `filiados: VISUALIZAR`. Oferecer o recadastro a ele seria
                  repetir o erro do botão de cadastrar, que eu já tinha
                  entregado morto uma vez: 403 na cara de quem clicou.
                */
                parte.filiadoId && podeCadastrarFiliado ? (
                  <button
                    type="button"
                    onClick={() => setRecadastrar({ id: parte.filiadoId!, nome: parte.nome })}
                    title={`Recadastrar ${parte.nome}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground sm:h-7 sm:w-7"
                  >
                    <UserCheck className="h-4 w-4" />
                    <span className="sr-only">Recadastrar</span>
                  </button>
                ) : null
              }
              ajuda={
                podeCadastrarFiliado ? (
                  <>
                    O primeiro da lista é o autor principal — a{' '}
                    <Star className="inline h-3 w-3 align-[-1px]" /> troca sem apagar nada. O{' '}
                    <UserCheck className="inline h-3 w-3 align-[-1px]" /> ao lado do {V.filiado}{' '}
                    abre o recadastramento, presencial ou por link.
                  </>
                ) : (
                  <>
                    O primeiro da lista é o autor principal. O cadastro de {V.filiado} é feito
                    pela secretaria — dá para seguir com o nome e vincular depois.
                  </>
                )
              }
            />

            {poloVazio && (
              <p className="rounded-md bg-muted px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
                Sem parte no polo ativo, o processo entra na fila{' '}
                <strong className="font-semibold text-foreground">sem {V.filiado} vinculado</strong> —
                dá para resolver depois, na aba Partes.
              </p>
            )}
          </div>

          {/* ---- POLO PASSIVO: contra quem ---- */}
          <div className="space-y-2 rounded-xl border p-3">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Building2 className="h-4 w-4 text-muted-foreground" /> Polo passivo — contra quem
            </label>

            {/*
              O AVISO DE DUPLICATA VIROU RESULTADO DE BUSCA.

              Os cadastros parecidos apareciam numa caixa amarela SEPARADA,
              depois do campo e depois do botão — quarta coisa na tela para uma
              pergunta só. E como ela continuava visível depois de acrescentar,
              dá para clicar "usar esta" outra vez e pôr a MESMA empresa duas
              vezes, uma pelo cadastro e outra como texto. Foi o que a tela do
              usuário mostrou.

              Agora eles são resultado da mesma busca, marcados pelo motivo da
              semelhança. Um lugar, uma decisão.
            */}
            <EditorDePartes
              partes={reus}
              onChange={setReus}
              placeholder="Nome da empresa, órgão ou pessoa…"
              rotuloPrincipal="Réu principal"
              rotuloSecundario="Litisconsorte"
              permitirTextoLivre
              vazio="Contra quem é a ação? Dá para deixar em branco e informar depois, na aba Partes."
              buscar={buscarReus}
              ajuda={
                <>
                  A API Pública do DataJud <strong>não divulga as partes</strong> do processo —
                  este dado é da casa. Reaproveitar um cadastro mantém todos os processos
                  contra a mesma empresa juntos.
                </>
              }
            />
          </div>

          </div>
        </div>

        {/*
          OS DOIS MODAIS FICAM POR CIMA, e não em outra tela: sair daqui para
          cadastrar ou recadastrar significaria perder o número do processo, o
          tribunal, a equipe e os réus já digitados. Ambos usam `z-[70]`, acima
          deste diálogo.
        */}
        <CadastroFiliadoModal
          open={cadastrando}
          nomeInicial={nomeParaCadastro}
          onClose={() => setCadastrando(false)}
          onSalvo={async (id) => {
            // A ficha vem da rota do próprio filiado: o polo tem de mostrar o
            // nome que foi CADASTRADO, e não o que se digitou na busca.
            const f = await api.get(`/filiados/${id}`).then((r) => r.data).catch(() => null);
            adicionarFiliado({
              tipo: 'FILIADO',
              nome: f?.nomeCompleto ?? nomeParaCadastro,
              detalhe: `${V.filiado} · cadastrado agora`,
              filiadoId: id,
            });
            setCadastrando(false);
          }}
        />

        {/*
          RECADASTRAR SEM SAIR DO PROCESSO.

          O modal já oferecia as duas portas — presencial (a equipe preenche na
          hora) e link de 24h para o próprio filiado. O que faltava era ele
          estar AQUI: o momento em que alguém abre um processo é o momento em
          que olha a ficha do filiado e vê que ela está velha.
        */}
        {recadastrar && (
          <RecadastrarModal
            open
            filiadoId={recadastrar.id}
            filiadoNome={recadastrar.nome}
            onClose={() => setRecadastrar(null)}
            semNavegar
            onRecadastrarPresencial={(id) => {
              setRecadastrar(null);
              setFiliadoParaRecadastro(id);
            }}
          />
        )}

        {/* Presencial: o mesmo formulário do cadastro, em modo recadastro. */}
        <CadastroFiliadoModal
          open={!!filiadoParaRecadastro}
          filiadoId={filiadoParaRecadastro}
          onClose={() => setFiliadoParaRecadastro(null)}
          onSalvo={() => {
            toast.success('Cadastro atualizado.');
            setFiliadoParaRecadastro(null);
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 p-4">
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            <kbd className="rounded border bg-card px-1 font-mono">Enter</kbd> importa ·{' '}
            <kbd className="rounded border bg-card px-1 font-mono">Esc</kbd> fecha
          </p>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={importar.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={importar.isPending}>
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
