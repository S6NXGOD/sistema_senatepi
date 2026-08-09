'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Loader2, Paperclip, Settings2, Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PALETA } from '@/lib/paleta-cores';
import { TiposMovimentacaoModal } from './tipos-movimentacao-modal';
import { uploadAnexo, MIME_ACEITOS, TAMANHO_MAX_MB } from '@/lib/anexos';
import {
  listarTiposMovimentacao, registrarMovimentacao, RegistrarMovimentacaoInput,
} from '@/lib/movimentacoes';
import {
  STATUS_PROCESSO_LABEL, STATUS_PROCESSO_ORDEM, StatusProcesso,
} from '@/lib/processos';

const campoCls =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-sm md:h-10';

/**
 * Formulário de registro de andamento — o advogado descreve o que aconteceu,
 * classifica por tipo, opcionalmente muda o status do processo e anexa um
 * documento. "Nota interna" marca o registro como de uso da equipe.
 */
export function RegistrarMovimentacaoForm({
  processoId,
  statusAtual,
  podeGerenciarTipos,
  onRegistrado,
}: {
  processoId: string;
  statusAtual: StatusProcesso;
  podeGerenciarTipos: boolean;
  onRegistrado: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: tipos = [] } = useQuery({
    queryKey: ['tipos-movimentacao', false],
    queryFn: () => listarTiposMovimentacao(false),
  });

  const [tipo, setTipo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [novoStatus, setNovoStatus] = useState<'' | StatusProcesso>('');
  const [notaInterna, setNotaInterna] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [gerenciarTipos, setGerenciarTipos] = useState(false);
  /**
   * Data do FATO (yyyy-MM-dd), opcional. Existe porque o advogado lança na
   * sexta a audiência que ocorreu na quarta: sem este campo a linha do tempo
   * registraria a sexta e contaria a história errada.
   */
  const [dataFato, setDataFato] = useState('');
  const hoje = new Date().toISOString().slice(0, 10);

  // Primeiro tipo da lista como padrão, assim que ela carrega.
  const tipoSelecionado = tipo || tipos[0]?.slug || '';
  const corAtual = PALETA[tipos.find((t) => t.slug === tipoSelecionado)?.cor ?? 'slate'] ?? PALETA.slate;

  const registrar = useMutation({
    mutationFn: async () => {
      let anexoId: string | undefined;
      // O arquivo vira um Anexo do processo (aparece também na aba Documentos)
      // e a movimentação apenas o referencia.
      if (arquivo) {
        const anexo = await uploadAnexo({ processoId }, arquivo);
        anexoId = anexo.id;
      }
      const dto: RegistrarMovimentacaoInput = {
        tipo: tipoSelecionado,
        descricao: descricao.trim(),
        notaInterna,
        // Meio-dia local evita que o fuso jogue a data para o dia anterior —
        // o usuário escolheu um DIA, não um instante.
        ...(dataFato ? { dataFato: new Date(`${dataFato}T12:00:00`).toISOString() } : {}),
        ...(novoStatus ? { novoStatus } : {}),
        ...(anexoId ? { anexoId } : {}),
      };
      return registrarMovimentacao(processoId, dto);
    },
    onSuccess: () => {
      toast.success('Movimentação registrada.');
      setDescricao(''); setNovoStatus(''); setNotaInterna(false); setArquivo(null); setDataFato('');
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['anexos', processoId] });
      onRegistrado();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível registrar a movimentação.'),
  });

  function submeter() {
    if (!tipoSelecionado) return toast.error('Selecione o tipo de movimentação.');
    if (descricao.trim().length < 3) return toast.error('Descreva a movimentação.');
    registrar.mutate();
  }

  function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > TAMANHO_MAX_MB * 1024 * 1024) {
      toast.error(`Arquivo maior que ${TAMANHO_MAX_MB} MB.`);
      e.target.value = '';
      return;
    }
    setArquivo(f);
  }

  return (
    <>
      <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Tipo (+ engrenagem para gerenciar) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Tipo de Movimentação</label>
              {podeGerenciarTipos && (
                <button
                  type="button"
                  onClick={() => setGerenciarTipos(true)}
                  title="Gerenciar tipos"
                  className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="relative">
              <span className={cn('pointer-events-none absolute left-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full', corAtual.ponto)} />
              <select
                className={cn(campoCls, 'pl-7')}
                value={tipoSelecionado}
                onChange={(e) => setTipo(e.target.value)}
              >
                {tipos.map((t) => (
                  <option key={t.id} value={t.slug}>{t.nome}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mudança de status (opcional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Alterar Status <span className="opacity-70">(opcional)</span>
            </label>
            <select
              className={campoCls}
              value={novoStatus}
              onChange={(e) => setNovoStatus(e.target.value as '' | StatusProcesso)}
            >
              <option value="">Manter status atual</option>
              {STATUS_PROCESSO_ORDEM.filter((s) => s !== statusAtual).map((s) => (
                <option key={s} value={s}>{STATUS_PROCESSO_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Data do fato — opcional, e o rótulo explica por que existe */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Data do fato <span className="opacity-70">(opcional)</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              className={cn(campoCls, 'sm:w-48')}
              value={dataFato}
              max={hoje}
              onChange={(e) => setDataFato(e.target.value)}
            />
            {dataFato ? (
              <button
                type="button"
                onClick={() => setDataFato('')}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> usar a data de hoje
              </button>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Deixe em branco se aconteceu hoje.
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Quando o ato ocorreu de fato. Lançando hoje uma audiência de outro dia, informe a data
            real — a linha do tempo se ordena por ela, e o registro fica marcado como feito hoje.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Descrição *</label>
          <textarea
            className="min-h-[80px] w-full resize-y rounded-md border border-input bg-background p-3 text-sm"
            placeholder="Descreva a movimentação…"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept={MIME_ACEITOS} className="hidden" onChange={aoEscolherArquivo} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-4 w-4" /> Anexar arquivo
          </Button>
          {arquivo && (
            <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
              <span className="max-w-[180px] truncate">{arquivo.name}</span>
              <button type="button" onClick={() => { setArquivo(null); if (fileRef.current) fileRef.current.value = ''; }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-800" checked={notaInterna} onChange={(e) => setNotaInterna(e.target.checked)} />
            <span className="flex items-center gap-1 text-muted-foreground">
              <Lock className="h-3.5 w-3.5 text-amber-600" /> Nota interna
            </span>
          </label>
        </div>

        <Button onClick={submeter} disabled={registrar.isPending} className="w-full sm:w-auto">
          {registrar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Registrar Movimentação
        </Button>
      </div>

      <TiposMovimentacaoModal
        open={gerenciarTipos}
        onClose={() => setGerenciarTipos(false)}
        podeExcluir={podeGerenciarTipos}
      />
    </>
  );
}
