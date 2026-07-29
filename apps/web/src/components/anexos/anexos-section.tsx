'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Paperclip, UploadCloud, FileText, Image as ImageIcon, Download, Trash2, Loader2, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listarAnexos, uploadAnexo, excluirAnexo, formatTamanho, ehImagem,
  MIME_ACEITOS, TAMANHO_MAX_MB, AlvoAnexo, Anexo,
} from '@/lib/anexos';

/**
 * Seção reutilizável de "Anexos" (drag & drop + lista para download rápido).
 * Vincula-se a um Atendimento (triagem) OU a um Processo.
 */
export function AnexosSection({ atendimentoId, processoId }: AlvoAnexo) {
  const qc = useQueryClient();
  const alvo: AlvoAnexo = atendimentoId ? { atendimentoId } : { processoId };
  const chave = ['anexos', atendimentoId ?? processoId];
  const habilitado = !!(atendimentoId || processoId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);

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
    }
  }

  const excluir = useMutation({
    mutationFn: (id: string) => excluirAnexo(id),
    onSuccess: () => {
      toast.success('Anexo removido.');
      qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível remover.'),
  });

  return (
    <section>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Paperclip className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> Anexos
        {anexos.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {anexos.length}
          </span>
        )}
      </h4>

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
            <AnexoItem key={a.id} anexo={a} onExcluir={() => excluir.mutate(a.id)} excluindo={excluir.isPending} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum anexo enviado.</p>
      )}

      {/* Aviso LGPD */}
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Arquivos (laudos, documentos pessoais) trafegam de forma segura, conforme o princípio da
        segurança da LGPD (Lei nº 13.709/2018).
      </p>
    </section>
  );
}

function AnexoItem({
  anexo,
  onExcluir,
  excluindo,
}: {
  anexo: Anexo;
  onExcluir: () => void;
  excluindo: boolean;
}) {
  const Icone = ehImagem(anexo.tipoMime) ? ImageIcon : FileText;
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icone className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={anexo.nomeArquivo}>
          {anexo.nomeArquivo}
        </p>
        <p className="text-[11px] text-muted-foreground">
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
      <button
        type="button"
        onClick={onExcluir}
        disabled={excluindo}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
        title="Remover"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
