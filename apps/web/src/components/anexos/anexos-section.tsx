'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { podeExcluir } from '@/lib/permissoes';
import {
  Paperclip, UploadCloud, FileText, Image as ImageIcon, Download, Trash2, Loader2,
  ShieldCheck, FolderInput, Link2, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listarAnexos, uploadAnexo, excluirAnexo, formatTamanho, ehImagem,
  MIME_ACEITOS, TAMANHO_MAX_MB, AlvoAnexo, Anexo,
} from '@/lib/anexos';
import { PuxarDocumentosModal } from '@/components/anexos/puxar-documentos-modal';

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
 * Com `filiadoId`, ganha o botão "Puxar do acervo": documentos que o filiado já
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

  async function enviar(files: FileList | File[]) {
    const lista = Array.from(files);
    if (!lista.length || enviando) return;
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
          <Paperclip className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> {titulo}
          {anexos.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {anexos.length}
            </span>
          )}
        </h4>
        {filiadoId && habilitado && (
          <button
            type="button"
            onClick={() => setPuxarAberto(true)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-senatepi-700 transition-colors hover:bg-muted dark:text-senatepi-400"
          >
            <FolderInput className="h-3.5 w-3.5" /> Puxar do acervo
          </button>
        )}
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
            ? 'border-senatepi-500 bg-senatepi-50 dark:bg-senatepi-900/20'
            : 'border-input hover:border-senatepi-400 hover:bg-muted/40',
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
            <Loader2 className="h-6 w-6 animate-spin text-senatepi-700 dark:text-senatepi-400" />
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

      {/* Lista de arquivos */}
      {isLoading ? (
        <div className="flex justify-center py-4 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
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
          <AnexoItem key={a.id} anexo={a} somenteLeitura />
        ))}
      </ul>
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
}: {
  anexo: Anexo;
  onExcluir?: () => void;
  excluindo?: boolean;
  somenteLeitura?: boolean;
}) {
  const Icone = ehImagem(anexo.tipoMime) ? ImageIcon : FileText;
  const reaproveitado = !!(anexo.origemAnexoId || anexo.origemDocumentoId);
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icone className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={anexo.nomeArquivo}>
          {anexo.nomeArquivo}
        </p>
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {reaproveitado && (
            <span
              className="flex items-center gap-0.5 font-medium text-senatepi-700 dark:text-senatepi-400"
              title="Puxado do acervo do filiado — não houve novo upload"
            >
              <Link2 className="h-3 w-3" /> puxado ·
            </span>
          )}
          {formatTamanho(anexo.tamanhoBytes)}
          {anexo.tamanhoBytes ? ' · ' : ''}
          {new Date(anexo.createdAt).toLocaleDateString('pt-BR')}
        </p>
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
      {!somenteLeitura && onExcluir && (
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
