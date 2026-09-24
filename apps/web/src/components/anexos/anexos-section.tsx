'use client';

import NextLink from 'next/link';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { podeExcluir } from '@/lib/permissoes';
import {
  Paperclip, UploadCloud, FileText, Image as ImageIcon, Download, Trash2, Loader2,
  ShieldCheck, FolderInput, Link2, ArrowRight, CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listarAnexos, listarAcervo, jaNoAcervo, uploadAnexo, excluirAnexo, formatTamanho, ehImagem,
  MIME_ACEITOS, TAMANHO_MAX_MB, AlvoAnexo, Anexo, ItemAcervo, ORIGEM_LABEL,
} from '@/lib/anexos';
import { PuxarDocumentosModal } from '@/components/anexos/puxar-documentos-modal';
import { VisorDeImagens } from '@/components/anexos/visor-de-imagens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { V } from '@/lib/vocabulario';

/**
 * O VISOR, e a lista de imagens que ele folheia.
 *
 * Fica num hook porque as DUAS listas da tela precisam dele — a do registro e
 * a herdada da origem —, e cada uma folheia as suas próprias imagens: abrir a
 * terceira foto do atendimento e avançar para um documento do processo seria
 * misturar dois conjuntos que a tela mostra separados de propósito.
 */
function useVisor(anexos: Anexo[]) {
  const [vendo, setVendo] = useState<number | null>(null);
  const imagens = anexos.filter((a) => ehImagem(a.tipoMime));
  const abrir = (a: Anexo) => {
    const i = imagens.findIndex((x) => x.id === a.id);
    return i < 0 ? undefined : () => setVendo(i);
  };
  return { imagens, vendo, setVendo, abrir, fechar: () => setVendo(null) };
}

/** Registro do qual esta seção HERDA documentos (só leitura). */
export interface HerancaAnexos {
  atendimentoId?: string;
  processoId?: string;
  /** Ex.: "Documentos anexados na triagem #393". */
  rotulo: string;
}

/**
 * Seção reutilizável de "Anexos" (drag & drop + lista para download rápido).
 * Vincula-se a um Atendimento (triagem), a um Processo ou a uma atividade da Agenda.
 *
 * Com `filiadoId`, ganha a oferta do acervo: os documentos que a pessoa já
 * entregou em outro atendimento entram aqui sem novo upload.
 *
 * Com `heranca`, mostra também (em bloco separado e só leitura) os documentos do
 * registro de origem — é a regra combinada com a triagem: o que foi puxado lá
 * segue disponível na consulta que nasceu do encaminhamento, sem puxar de novo.
 */
export function AnexosSection({
  atendimentoId,
  processoId,
  compromissoId,
  filiadoId,
  heranca,
  titulo = 'Anexos',
}: AlvoAnexo & {
  filiadoId?: string | null;
  heranca?: HerancaAnexos;
  titulo?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  const alvo: AlvoAnexo = atendimentoId
    ? { atendimentoId }
    : processoId
      ? { processoId }
      : { compromissoId };
  const chave = ['anexos', atendimentoId ?? processoId ?? compromissoId];
  const habilitado = !!(atendimentoId || processoId || compromissoId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [puxarAberto, setPuxarAberto] = useState(false);

  const { data: anexos = [], isLoading } = useQuery({
    queryKey: chave,
    queryFn: () => listarAnexos(alvo),
    enabled: habilitado,
  });
  /*
    O ACERVO SE ANUNCIA, em vez de esperar alguém lembrar do botão (18/09/2026).

    "É avisado que existem documentos no acervo para não colocar repetido?" Não
    era. O botão "Puxar do acervo" resolvia desde sempre — para quem sabia que
    ele existia. A triagem fotografa a CTPS, o advogado abre o processo e
    fotografa de novo, e o mesmo documento passa a existir três vezes.

    A lista é curta (é o que UMA pessoa entregou) e já é buscada pelo modal:
    trazer aqui não custa consulta nova, o cache é o mesmo.
  */
  const { data: acervo = [] } = useQuery({
    queryKey: ['acervo', filiadoId, alvo],
    queryFn: () => listarAcervo(filiadoId as string, alvo),
    enabled: !!filiadoId && habilitado,
    staleTime: 60_000,
  });
  const aPuxar = acervo.filter((i) => !i.jaVinculado).length;
  /** O arquivo que o envio parou para perguntar — nulo quando não há dúvida. */
  const [repetido, setRepetido] = useState<{ arquivo: File; achado: ItemAcervo } | null>(null);
  const { imagens, vendo, setVendo, abrir, fechar } = useVisor(anexos);

  async function enviar(files: FileList | File[], ignorarRepetido = false) {
    const lista = Array.from(files);
    if (!lista.length || enviando) return;
    /*
      PARA E PERGUNTA quando reconhece o arquivo (18/09/2026).

      Não bloqueia: o casamento é por nome e tamanho, e pode errar — duas fotos
      diferentes com o nome que a câmera deu. Perguntar custa um clique e evita
      a terceira cópia da mesma carteira de trabalho no acervo de alguém.

      Só o PRIMEIRO repetido interrompe. Parar em cada um transformaria um lote
      de dezessete fotos num interrogatório.
    */
    const achado = lista.map((f) => ({ f, achado: jaNoAcervo(f, acervo) })).find((x) => x.achado);
    if (achado?.achado && !ignorarRepetido) {
      setRepetido({ arquivo: achado.f, achado: achado.achado });
      return;
    }

    setEnviando(true);
    let ok = 0;
    for (const f of lista) {
      setProgresso(0);
      try {
        await uploadAnexo(alvo, f, setProgresso);
        ok++;
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? `Falha ao enviar "${f.name}".`);
      }
    }
    setEnviando(false);
    setProgresso(0);
    if (inputRef.current) inputRef.current.value = '';
    if (ok) {
      toast.success(ok === 1 ? 'Anexo enviado.' : `${ok} anexos enviados.`);
      qc.invalidateQueries({ queryKey: chave });
      if (filiadoId) qc.invalidateQueries({ queryKey: ['acervo', filiadoId] });
    }
  }

  const excluir = useMutation({
    mutationFn: (id: string) => excluirAnexo(id),
    onSuccess: (r) => {
      toast.success(
        r.arquivoMantido
          ? 'Documento desvinculado daqui (segue disponível nos outros registros).'
          : 'Anexo removido.',
      );
      qc.invalidateQueries({ queryKey: chave });
      if (filiadoId) qc.invalidateQueries({ queryKey: ['acervo', filiadoId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível remover.'),
  });

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="h-4 w-4 text-brand-700 dark:text-brand-400" /> {titulo}
          {anexos.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {anexos.length}
            </span>
          )}
        </h4>
      </div>

      {/* Dropzone */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void enviar(e.dataTransfer.files);
        }}
        disabled={enviando}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragOver
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
            : 'border-input hover:border-brand-400 hover:bg-muted/40',
          enviando && 'pointer-events-none opacity-70',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={MIME_ACEITOS}
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void enviar(e.target.files)}
        />
        {enviando ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-brand-700 dark:text-brand-400" />
            <span className="text-sm font-medium">Enviando… {progresso}%</span>
          </>
        ) : (
          <>
            <UploadCloud className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">Arraste arquivos ou clique para enviar</span>
            <span className="text-[11px] text-muted-foreground">
              PDF, DOC, DOCX, JPG ou PNG · até {TAMANHO_MAX_MB} MB
            </span>
          </>
        )}
      </button>

      {/*
        O ACERVO FALA NO MOMENTO DA ESCOLHA (24/09/2026).

        MEDIDO na produção: dos 83 anexos enviados, `veio_do_acervo` era ZERO —
        e nos 18 do atendimento, 17 tinham documento disponível para puxar. O
        recurso não faltava; faltava PESO. O dropzone tracejado ocupa a largura
        inteira e o acervo era um chip de 11px no canto do cabeçalho, brigando
        por espaço com o título. Quem nunca tinha visto o botão subia o arquivo
        de novo — e é assim que a mesma CTPS passa a existir três vezes.

        Agora a frase fica ENTRE o dropzone e a lista: no caminho do olho, na
        hora em que a pessoa decide de onde vem o arquivo. E diz o FATO que ela
        não sabe — quantos documentos essa pessoa já entregou ao sindicato.

        PORTA ÚNICA: o chip do cabeçalho saiu. Duas entradas para o mesmo modal
        na mesma dobra é o que a régua do painel proíbe. E quando não há nada
        para puxar — 21 pessoas com acervo na produção inteira — NADA aparece:
        botão que abre lista vazia é beco, não recurso.

        O substantivo vem do vocabulário do cliente: "filiado" no SENATEPI,
        "servidor" no SINDSERM.
      */}
      {aPuxar > 0 && (
        <button
          type="button"
          onClick={() => setPuxarAberto(true)}
          className="mt-2 flex w-full items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2.5 text-left transition-colors hover:bg-brand-50 dark:border-brand-900/70 dark:bg-brand-900/20 dark:hover:bg-brand-900/30"
        >
          <FolderInput className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
          <span className="min-w-0 flex-1 text-xs leading-snug">
            <span className="font-semibold text-brand-800 dark:text-brand-200">
              Este {V.filiado} já entregou {aPuxar} documento{aPuxar > 1 ? 's' : ''}
            </span>
            <span className="text-muted-foreground">
              {aPuxar > 1 ? ' — puxe os que servirem.' : ' — puxe em vez de enviar de novo.'}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
        </button>
      )}

      {/* Lista de arquivos */}
      {isLoading ? (
        <Carregando texto="Carregando os documentos…" className="mt-3 space-y-2">
          <EsqueletoLinhas quantidade={2} altura={56} className="divide-y-0 rounded-lg border" />
        </Carregando>
      ) : anexos.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {anexos.map((a) => (
            <AnexoItem
              key={a.id}
              anexo={a}
              // Só o Administrador apaga (regra global). Para os demais o botão
              // nem aparece — a API responderia 403 depois do clique.
              onExcluir={ehAdmin ? () => excluir.mutate(a.id) : undefined}
              excluindo={excluir.isPending}
              onAbrir={abrir(a)}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum anexo enviado.</p>
      )}

      {/* Herdados do registro de origem — só leitura */}
      {heranca && <AnexosHerdados heranca={heranca} />}

      {/* Aviso LGPD */}
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Arquivos (laudos, documentos pessoais) trafegam de forma segura, conforme o princípio da
        segurança da LGPD (Lei nº 13.709/2018).
      </p>

      {filiadoId && (
        <PuxarDocumentosModal
          open={puxarAberto}
          onClose={() => setPuxarAberto(false)}
          filiadoId={filiadoId}
          alvo={alvo}
          chaveCache={chave}
        />
      )}

      <VisorDeImagens imagens={imagens} indice={vendo} onFechar={fechar} onIr={setVendo} />

      {/*
        O DIÁLOGO DO ARQUIVO REPETIDO. Duas saídas de verdade: puxar do acervo
        (o certo, sem nova cópia) ou enviar assim mesmo. Não é destrutivo — nada
        se apaga —, então o Enter confirma e o foco cai no botão de confirmar.
      */}
      <ConfirmDialog
        open={!!repetido}
        title="Este arquivo já está no acervo"
        confirmLabel="Puxar do acervo"
        cancelLabel="Enviar assim mesmo"
        confirmarComEnter
        icon={<FolderInput className="h-6 w-6" />}
        description={
          repetido && (
            <div className="space-y-2">
              <p>
                <strong className="text-foreground">{repetido.achado.nomeArquivo}</strong> já foi
                entregue em{' '}
                {ORIGEM_LABEL[repetido.achado.origemTipo] ?? repetido.achado.origemRotulo} no dia{' '}
                {new Date(repetido.achado.createdAt).toLocaleDateString('pt-BR')}.
              </p>
              <p>
                Puxar de lá aproveita o mesmo arquivo, sem criar outra cópia no acervo do
                {' '}{V.filiado}. Se for um documento diferente com o mesmo nome, envie assim mesmo.
              </p>
            </div>
          )
        }
        onConfirm={() => {
          setRepetido(null);
          setPuxarAberto(true);
        }}
        onClose={() => {
          const arquivo = repetido?.arquivo;
          setRepetido(null);
          // "Enviar assim mesmo" é o CANCELAR: a saída sem novidade é não puxar.
          if (arquivo) void enviar([arquivo], true);
        }}
      />
    </section>
  );
}

/**
 * Documentos que vêm do registro de origem (a triagem que virou consulta, o
 * processo do compromisso). Não são copiados: aparecem aqui porque o vínculo já
 * existe lá — por isso não há upload nem exclusão neste bloco.
 */
function AnexosHerdados({ heranca }: { heranca: HerancaAnexos }) {
  const alvo: AlvoAnexo = heranca.atendimentoId
    ? { atendimentoId: heranca.atendimentoId }
    : { processoId: heranca.processoId };

  const { data: anexos = [], isLoading } = useQuery({
    queryKey: ['anexos', heranca.atendimentoId ?? heranca.processoId],
    queryFn: () => listarAnexos(alvo),
    enabled: !!(heranca.atendimentoId || heranca.processoId),
  });
  const { imagens, vendo, setVendo, abrir, fechar } = useVisor(anexos);

  if (isLoading || anexos.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-dashed bg-muted/20 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5 shrink-0" /> {heranca.rotulo}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
          {anexos.length}
        </span>
      </p>
      <ul className="space-y-2">
        {anexos.map((a) => (
          <AnexoItem key={a.id} anexo={a} somenteLeitura onAbrir={abrir(a)} />
        ))}
      </ul>
      <VisorDeImagens imagens={imagens} indice={vendo} onFechar={fechar} onIr={setVendo} />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Já vieram da origem — não precisam ser puxados de novo.
      </p>
    </div>
  );
}

function AnexoItem({
  anexo,
  onExcluir,
  excluindo,
  somenteLeitura,
  onAbrir,
}: {
  anexo: Anexo;
  onExcluir?: () => void;
  excluindo?: boolean;
  somenteLeitura?: boolean;
  /** Abre o visor. Só chega para imagem — ver `VisorDeImagens`. */
  onAbrir?: () => void;
}) {
  const imagem = ehImagem(anexo.tipoMime);
  const Icone = imagem ? ImageIcon : FileText;
  // A miniatura pode falhar: a URL é assinada e vale uma hora. Aí volta o ícone,
  // em vez de deixar um quadrado quebrado na lista.
  const [semMiniatura, setSemMiniatura] = useState(false);
  const podeAbrir = imagem && !semMiniatura && !!onAbrir;
  // Apagar acontece onde o documento MORA. Na ficha do processo, um anexo
  // que é da atividade só se lê — senão o mesmo botão teria dois efeitos
  // diferentes dependendo da aba em que foi clicado.
  const daAtividade = !!anexo.viaAtividade;
  const reaproveitado = !!(anexo.origemAnexoId || anexo.origemDocumentoId);
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      {/*
        A IMAGEM É A PRÓPRIA IDENTIFICAÇÃO (18/09/2026).

        Aqui havia um ícone genérico para todo mundo. Num atendimento com 17
        fotos de celular — IMG-20250818-WA0027.jpg, …WA0024.jpg, …WA0023.jpg —
        o nome não diz nada, e descobrir qual é a carteira de trabalho exigia
        baixar as 17. A miniatura responde de relance e abre o visor no clique.

        `loading="lazy"`: uma gaveta com 17 fotos não baixa 2 MB de uma vez.
      */}
      {podeAbrir ? (
        <button
          type="button"
          onClick={onAbrir}
          className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-muted"
          title="Ver a imagem"
          aria-label={`Ver ${anexo.nomeArquivo}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={anexo.url}
            alt=""
            loading="lazy"
            onError={() => setSemMiniatura(true)}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        </button>
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icone className="h-4 w-4 text-brand-700 dark:text-brand-400" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {podeAbrir ? (
          <button
            type="button"
            onClick={onAbrir}
            className="block max-w-full truncate text-left text-sm font-medium hover:underline"
            title={`Ver ${anexo.nomeArquivo}`}
          >
            {anexo.nomeArquivo}
          </button>
        ) : (
          <p className="truncate text-sm font-medium" title={anexo.nomeArquivo}>
            {anexo.nomeArquivo}
          </p>
        )}
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {reaproveitado && (
            <span
              className="flex items-center gap-0.5 font-medium text-brand-700 dark:text-brand-400"
              title={`Puxado do acervo do ${V.filiado} — não houve novo upload`}
            >
              <Link2 className="h-3 w-3" /> puxado ·
            </span>
          )}
          {formatTamanho(anexo.tamanhoBytes)}
          {anexo.tamanhoBytes ? ' · ' : ''}
          {new Date(anexo.createdAt).toLocaleDateString('pt-BR')}
        </p>
        {/*
          DE ONDE ELE VEIO. O documento mora na ATIVIDADE — é lá que ele foi
          anexado e é lá que se apaga. A ficha do processo o mostra para o
          advogado não abrir o processo e não achar a própria petição, mas
          sem fingir que é dela: o rótulo leva de volta à atividade.
        */}
        {anexo.viaAtividade && (
          <NextLink
            href={`/agenda?compromisso=${anexo.viaAtividade.id}`}
            className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-brand-800 hover:underline dark:text-brand-300"
          >
            <CalendarClock className="h-3 w-3 shrink-0" />
            <span className="truncate">da atividade “{anexo.viaAtividade.titulo}”</span>
          </NextLink>
        )}
      </div>
      <a
        href={anexo.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Baixar"
      >
        <Download className="h-4 w-4" />
      </a>
      {!somenteLeitura && !daAtividade && onExcluir && (
        <button
          type="button"
          onClick={onExcluir}
          disabled={excluindo}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
          title="Remover"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
