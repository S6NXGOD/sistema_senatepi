'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check, CheckCircle2, Download, FileText, FolderInput, Image as ImageIcon,
  Loader2, Search, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  listarAcervo, puxarAnexos, formatTamanho, ehImagem,
  ORIGEM_COR, ORIGEM_LABEL, type AlvoAnexo, type ItemAcervo, type OrigemAcervo,
} from '@/lib/anexos';
import { V } from '@/lib/vocabulario';

/**
 * "Puxar documento de outro atendimento".
 *
 * O filiado entrega o mesmo laudo, RG ou contracheque várias vezes por ano. Em
 * vez de pedir o arquivo de novo (e ocupar o balcão com scanner), a equipe
 * escolhe aqui o que já está no acervo dele: o vínculo é criado apontando para o
 * MESMO arquivo, sem upload.
 *
 * O que já está disponível no registro aparece marcado e desabilitado — inclusive
 * o que chega HERDADO da triagem de origem: se o documento foi puxado na triagem
 * e o atendimento virou consulta com o advogado, ele já está lá.
 */
export function PuxarDocumentosModal({
  open, onClose, filiadoId, alvo, chaveCache,
}: {
  open: boolean;
  onClose: () => void;
  filiadoId: string;
  alvo: AlvoAnexo;
  /** Query key da lista de anexos do registro — invalidada ao puxar. */
  chaveCache: unknown[];
}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<OrigemAcervo | 'TODOS'>('TODOS');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const { data: acervo = [], isLoading } = useQuery({
    queryKey: ['acervo', filiadoId, alvo],
    queryFn: () => listarAcervo(filiadoId, alvo),
    enabled: open && !!filiadoId,
  });

  const puxar = useMutation({
    mutationFn: () => {
      const itens = acervo
        .filter((i) => selecionados.has(i.origemId))
        .map((i) => ({ origemTipo: i.origemTipo, origemId: i.origemId }));
      return puxarAnexos(alvo, itens);
    },
    onSuccess: (r) => {
      const n = r.criados.length;
      if (n > 0) {
        toast.success(
          n === 1
            ? 'Documento vinculado — sem novo upload.'
            : `${n} documentos vinculados — sem novo upload.`,
        );
      }
      if (r.ignorados > 0) {
        toast.info(`${r.ignorados} já estava(m) disponível(is) neste registro.`);
      }
      qc.invalidateQueries({ queryKey: chaveCache });
      qc.invalidateQueries({ queryKey: ['acervo', filiadoId] });
      fechar();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível puxar os documentos.');
    },
  });

  const disponiveis = useMemo(() => acervo.filter((i) => !i.jaVinculado), [acervo]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return acervo.filter((i) => {
      if (filtro !== 'TODOS' && i.origemTipo !== filtro) return false;
      if (!termo) return true;
      return (
        i.nomeArquivo.toLowerCase().includes(termo) ||
        i.origemRotulo.toLowerCase().includes(termo)
      );
    });
  }, [acervo, busca, filtro]);

  function fechar() {
    setSelecionados(new Set());
    setBusca('');
    setFiltro('TODOS');
    onClose();
  }

  function alternar(item: ItemAcervo) {
    if (item.jaVinculado) return;
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(item.origemId)) novo.delete(item.origemId);
      else novo.add(item.origemId);
      return novo;
    });
  }

  function selecionarTodos() {
    const alvos = visiveis.filter((i) => !i.jaVinculado).map((i) => i.origemId);
    const todosMarcados = alvos.every((id) => selecionados.has(id));
    setSelecionados(todosMarcados ? new Set() : new Set(alvos));
  }

  if (!open) return null;

  const origensPresentes = [...new Set(acervo.map((i) => i.origemTipo))];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={puxar.isPending ? undefined : fechar}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:max-h-[85vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3 border-b p-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <FolderInput className="h-[18px] w-[18px] text-brand-700 dark:text-brand-400" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold">Puxar documentos do {V.filiado}</h3>
              <p className="truncate text-xs text-muted-foreground">
                Reaproveita o que já foi entregue — sem pedir o arquivo de novo.
              </p>
            </div>
          </div>
          <button type="button" onClick={fechar} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Busca e filtros */}
        <div className="space-y-3 border-b p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome do arquivo ou origem…"
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          {origensPresentes.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <Chip ativo={filtro === 'TODOS'} onClick={() => setFiltro('TODOS')}>
                Todos ({acervo.length})
              </Chip>
              {origensPresentes.map((o) => (
                <Chip key={o} ativo={filtro === o} onClick={() => setFiltro(o)}>
                  {ORIGEM_LABEL[o]} ({acervo.filter((i) => i.origemTipo === o).length})
                </Chip>
              ))}
            </div>
          )}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-brand-700 dark:text-brand-400" />
            </div>
          ) : acervo.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Este filiado ainda não tem nenhum documento no sistema.
            </p>
          ) : visiveis.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum documento corresponde à busca.
            </p>
          ) : (
            <ul className="space-y-2">
              {visiveis.map((item) => (
                <ItemLinha
                  key={`${item.origemTipo}:${item.origemId}`}
                  item={item}
                  marcado={selecionados.has(item.origemId)}
                  onToggle={() => alternar(item)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
          <div className="flex items-center gap-3">
            {disponiveis.length > 0 && (
              <button
                type="button"
                onClick={selecionarTodos}
                className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
              >
                Selecionar todos os visíveis
              </button>
            )}
            <span className="text-xs text-muted-foreground">
              {selecionados.size > 0
                ? `${selecionados.size} selecionado(s)`
                : `${disponiveis.length} disponível(is) para puxar`}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fechar} disabled={puxar.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => puxar.mutate()}
              disabled={selecionados.size === 0 || puxar.isPending}
            >
              {puxar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderInput className="h-4 w-4" />
              )}
              Puxar {selecionados.size > 0 ? `(${selecionados.size})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemLinha({
  item, marcado, onToggle,
}: {
  item: ItemAcervo;
  marcado: boolean;
  onToggle: () => void;
}) {
  const Icone = ehImagem(item.tipoMime) ? ImageIcon : FileText;
  return (
    <li>
      <div
        role="button"
        tabIndex={item.jaVinculado ? -1 : 0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          'flex items-center gap-3 rounded-xl border p-3 transition-colors',
          item.jaVinculado
            ? 'cursor-default border-dashed bg-muted/30 opacity-70'
            : marcado
              ? 'cursor-pointer border-brand-500 bg-brand-50/60 dark:bg-brand-900/20'
              : 'cursor-pointer hover:border-brand-400 hover:bg-muted/40',
        )}
      >
        {/* Caixa de seleção */}
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
            item.jaVinculado
              ? 'border-transparent bg-emerald-600 text-white'
              : marcado
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-input',
          )}
        >
          {(marcado || item.jaVinculado) && <Check className="h-3.5 w-3.5" />}
        </span>

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icone className="h-4 w-4 text-brand-700 dark:text-brand-400" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.nomeArquivo}>
            {item.nomeArquivo}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                ORIGEM_COR[item.origemTipo],
              )}
            >
              {ORIGEM_LABEL[item.origemTipo]}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {item.origemRotulo}
              {item.tamanhoBytes ? ` · ${formatTamanho(item.tamanhoBytes)}` : ''}
            </span>
          </div>
          {item.jaVinculado && (
            <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Já disponível neste registro
            </p>
          )}
        </div>

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Abrir para conferir"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
    </li>
  );
}

function Chip({
  ativo, onClick, children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        ativo
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-input text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
