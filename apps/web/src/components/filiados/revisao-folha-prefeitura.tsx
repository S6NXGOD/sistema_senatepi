'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Copy, Loader2, Search, UserPlus,
  UserCheck, XCircle, SkipForward,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { mascararCpf } from '@/lib/utils';
import {
  CAMPO_LABEL, CLASSIFICACAO_LABEL, ClassificacaoLinha, DecisaoConflito,
  Importacao, LinhaFolha, MOTIVO_CONFLITO_LABEL, MotivoConflito, ResumoFolha,
  valorDoCampo,
} from '@/lib/importacao';
import { V } from '@/lib/vocabulario';

/**
 * REVISÃO DA FOLHA DA PREFEITURA — a tela onde a importação é decidida.
 *
 * As cinco categorias não são enfeite: NOVO e ATUALIZACAO entram sozinhos,
 * DUPLICIDADE e ERRO nunca entram, e CONFLITO só entra depois que alguém
 * responde. A tela existe para tornar essa diferença óbvia antes do clique —
 * depois de importar 4.000 linhas, desfazer é trabalho de semanas.
 */

const CORES: Record<ClassificacaoLinha, { chip: string; icone: typeof UserPlus; cor: string }> = {
  NOVO: { chip: 'bg-brand-50 text-brand-800', icone: UserPlus, cor: 'text-brand-800' },
  ATUALIZACAO: { chip: 'bg-blue-100 text-blue-700', icone: UserCheck, cor: 'text-blue-600' },
  CONFLITO: { chip: 'bg-amber-100 text-amber-800', icone: AlertTriangle, cor: 'text-amber-600' },
  DUPLICIDADE: { chip: 'bg-orange-100 text-orange-700', icone: Copy, cor: 'text-orange-600' },
  ERRO: { chip: 'bg-red-100 text-red-700', icone: XCircle, cor: 'text-red-600' },
};

export function RevisaoFolhaPrefeitura({
  importacaoId,
  importacao,
  onConfirmado,
}: {
  importacaoId: string;
  importacao: Importacao;
  onConfirmado: () => void;
}) {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<ClassificacaoLinha | ''>('');
  const [busca, setBusca] = useState('');
  const [page, setPage] = useState(1);
  const [ignorarPendentes, setIgnorarPendentes] = useState(false);

  const { data: resumo } = useQuery<ResumoFolha>({
    queryKey: ['folha-resumo', importacaoId],
    queryFn: async () => (await api.get(`/importacoes/folha/${importacaoId}/resumo`)).data,
  });

  const { data: linhas, isFetching } = useQuery({
    queryKey: ['folha-linhas', importacaoId, filtro, busca, page],
    queryFn: async () =>
      (
        await api.get(`/importacoes/folha/${importacaoId}/linhas`, {
          params: { classificacao: filtro || undefined, busca: busca || undefined, page },
        })
      ).data as { data: LinhaFolha[]; total: number; totalPages: number },
  });

  function recarregar() {
    qc.invalidateQueries({ queryKey: ['folha-resumo', importacaoId] });
    qc.invalidateQueries({ queryKey: ['folha-linhas', importacaoId] });
  }

  const decidir = useMutation({
    mutationFn: async (v: { linhaId: string; decisao: DecisaoConflito; filiadoId?: string }) =>
      api.patch(`/importacoes/folha/${importacaoId}/linhas/${v.linhaId}/decisao`, {
        decisao: v.decisao,
        filiadoId: v.filiadoId,
      }),
    onSuccess: recarregar,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível registrar a decisão'),
  });

  const decidirLote = useMutation({
    mutationFn: async (v: { motivo: MotivoConflito; decisao: DecisaoConflito }) =>
      api.post(`/importacoes/folha/${importacaoId}/decisao-em-lote`, v),
    onSuccess: (r: any) => {
      toast.success(`${r.data.atualizadas} conflito(s) decidido(s)`);
      recarregar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível aplicar em lote'),
  });

  const confirmar = useMutation({
    mutationFn: async () =>
      api.post(`/importacoes/folha/${importacaoId}/confirmar`, {
        ignorarConflitosPendentes: ignorarPendentes,
      }),
    onSuccess: onConfirmado,
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível iniciar a importação'),
  });

  const contagem = resumo?.contagem;
  const pendentes = resumo?.conflitosPendentes ?? 0;
  const entrarao = (contagem?.NOVO ?? 0) + (contagem?.ATUALIZACAO ?? 0);

  return (
    <div className="space-y-6">
      {importacao.reenvioDe && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Este arquivo já havia sido importado antes. Você optou por processá-lo de novo — as
            linhas que não mudaram aparecerão como atualizações sem alteração.
          </span>
        </div>
      )}

      {/* Cartões por categoria — clicáveis, viram filtro */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {(Object.keys(CLASSIFICACAO_LABEL) as ClassificacaoLinha[]).map((c) => {
          const { icone: Icone, cor } = CORES[c];
          const ativo = filtro === c;
          return (
            <button
              key={c}
              onClick={() => { setFiltro(ativo ? '' : c); setPage(1); }}
              className={`rounded-xl border p-4 text-left transition-colors hover:border-brand-600 ${ativo ? 'border-brand-600 bg-brand-50/40' : ''}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{CLASSIFICACAO_LABEL[c]}</p>
                <Icone className={`h-5 w-5 ${cor}`} />
              </div>
              <p className="mt-1 text-2xl font-bold">{contagem?.[c] ?? 0}</p>
            </button>
          );
        })}
      </div>

      {/* O que vai acontecer, em uma frase */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-brand-700" />
            <strong>{entrarao}</strong> {V.filiados} serão criados ou atualizados
          </span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <SkipForward className="h-4 w-4" />
            <strong>{(contagem?.DUPLICIDADE ?? 0) + (contagem?.ERRO ?? 0)}</strong> ficam de fora
            (duplicidades e erros)
          </span>
          {pendentes > 0 && (
            <span className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              <strong>{pendentes}</strong> conflito(s) aguardam sua decisão
            </span>
          )}
        </CardContent>
      </Card>

      {/* Mutirão: mesma decisão para um motivo inteiro */}
      {pendentes > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="text-base">Decidir em lote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Vale para os conflitos que ainda não foram decididos. Vincular a um cadastro
              existente continua sendo um a um — o candidato muda em cada linha.
            </p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(MOTIVO_CONFLITO_LABEL) as MotivoConflito[]).map((m) => (
                <div key={m} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                  <span className="text-muted-foreground">{MOTIVO_CONFLITO_LABEL[m]}:</span>
                  <Button size="sm" variant="outline"
                    onClick={() => decidirLote.mutate({ motivo: m, decisao: 'PESSOA_DIFERENTE' })}>
                    Criar cadastros novos
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => decidirLote.mutate({ motivo: m, decisao: 'IGNORAR' })}>
                    Deixar de fora
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Prévia */}
      <Card>
        <CardHeader><CardTitle>Prévia de conferência</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
              <Input placeholder="Buscar nome, matrícula, órgão..." className="pl-10"
                value={busca} onChange={(e) => { setBusca(e.target.value); setPage(1); }} />
            </div>
            {filtro && (
              <Button size="sm" variant="outline" onClick={() => { setFiltro(''); setPage(1); }}>
                Limpar filtro: {CLASSIFICACAO_LABEL[filtro]}
              </Button>
            )}
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Matrícula</th>
                  <th className="px-3 py-2 font-medium">Órgão / Lotação</th>
                  <th className="px-3 py-2 font-medium">Cargo / Quadro</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {linhas?.data.map((l) => (
                  <LinhaTabela key={l.id} linha={l} onDecidir={(d, filiadoId) =>
                    decidir.mutate({ linhaId: l.id, decisao: d, filiadoId })} />
                ))}
                {linhas && linhas.data.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Nenhum registro</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {linhas && linhas.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <span className="text-sm text-muted-foreground">Página {page} de {linhas.totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= linhas.totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmação */}
      <Card>
        <CardHeader><CardTitle>Confirmar importação</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• Campo em branco na planilha <strong>nunca</strong> apaga o que já está cadastrado.</li>
            <li>• Nome do cadastro existente não é sobrescrito pelo da folha.</li>
            <li>• Cada alteração fica registrada no histórico do {V.filiado}, com o valor anterior.</li>
            <li>
              • A {V.matricula} do cadastro é a da Prefeitura — a importação não cria número novo.
            </li>
            <li>
              • <strong>Nenhuma carteirinha é emitida aqui.</strong> Ela é emitida na tela de
              carteirinhas, depois que o desconto em folha estiver identificado.
            </li>
          </ul>

          {pendentes > 0 && (
            <label className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <input type="checkbox" className="accent-amber-600" checked={ignorarPendentes}
                onChange={(e) => setIgnorarPendentes(e.target.checked)} />
              Importar mesmo assim, deixando os {pendentes} conflito(s) sem decisão de fora desta rodada
            </label>
          )}

          <div className="flex justify-end">
            <Button onClick={() => confirmar.mutate()}
              disabled={confirmar.isPending || (pendentes > 0 && !ignorarPendentes) || entrarao === 0}>
              {confirmar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Importar {entrarao} registro(s)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Uma linha, com o painel de decisão embutido quando é conflito. */
function LinhaTabela({
  linha,
  onDecidir,
}: {
  linha: LinhaFolha;
  onDecidir: (decisao: DecisaoConflito, filiadoId?: string) => void;
}) {
  const c = linha.classificacao ?? 'ERRO';
  const alteracoes = Object.entries(linha.alteracoes ?? {});

  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-3 py-2 text-muted-foreground">{linha.linha}</td>
      <td className="px-3 py-2 font-medium">{linha.nome ?? '-'}</td>
      <td className="px-3 py-2 font-mono text-xs">{linha.matricula ?? '—'}</td>
      <td className="px-3 py-2">
        <p>{linha.empresa ?? '-'}</p>
        {linha.lotacao && <p className="text-xs text-muted-foreground">{linha.lotacao}</p>}
      </td>
      <td className="px-3 py-2">
        <p>{linha.cargo ?? '-'}</p>
        {linha.quadro && <p className="text-xs text-muted-foreground">{linha.quadro}</p>}
      </td>
      <td className="px-3 py-2">
        <Badge className={CORES[c].chip}>{CLASSIFICACAO_LABEL[c]}</Badge>

        {/* O que vai mudar, campo a campo — é a promessa que a execução cumpre */}
        {alteracoes.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {alteracoes.map(([campo, a]) => (
              <li key={campo} className="flex items-center gap-1 text-[11px] text-blue-700">
                <span className="font-medium">{CAMPO_LABEL[campo] ?? campo}:</span>
                <span className="text-muted-foreground line-through">
                  {valorDoCampo(campo, a.de)}
                </span>
                <ArrowRight className="h-3 w-3" />
                <span>{valorDoCampo(campo, a.para)}</span>
              </li>
            ))}
          </ul>
        )}

        {(linha.erros ?? []).map((m, i) => (
          <p key={`e${i}`} className="mt-1 max-w-[320px] text-[11px] text-red-600">• {m}</p>
        ))}
        {(linha.avisos ?? []).map((m, i) => (
          <p key={`a${i}`} className="mt-1 max-w-[320px] text-[11px] text-amber-700">• {m}</p>
        ))}

        {c === 'CONFLITO' && (
          <PainelConflito linha={linha} onDecidir={onDecidir} />
        )}
      </td>
    </tr>
  );
}

/**
 * O painel que mostra O CANDIDATO e pergunta. Sem a ficha à vista — nome,
 * matrícula sindical, CPF e os vínculos que a pessoa já tem — a pergunta "é a
 * mesma pessoa?" não teria como ser respondida, e o operador clicaria no que
 * fosse mais rápido.
 */
function PainelConflito({
  linha,
  onDecidir,
}: {
  linha: LinhaFolha;
  onDecidir: (decisao: DecisaoConflito, filiadoId?: string) => void;
}) {
  if (linha.decisao !== 'PENDENTE') {
    const rotulo: Record<DecisaoConflito, string> = {
      PENDENTE: '',
      MESMA_PESSOA: 'Decidido: é a mesma pessoa — vínculo será anexado',
      PESSOA_DIFERENTE: 'Decidido: pessoa diferente — cadastro novo',
      IGNORAR: 'Decidido: deixar de fora desta importação',
    };
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50/50 px-2 py-1.5 text-[11px]">
        <CheckCircle2 className="h-3.5 w-3.5 text-brand-700" />
        <span>{rotulo[linha.decisao]}</span>
        <button className="ml-auto underline hover:no-underline" onClick={() => onDecidir('PENDENTE')}>
          desfazer
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 max-w-[420px] rounded-lg border border-amber-300 bg-amber-50/60 p-2">
      {linha.motivoConflito && (
        <p className="mb-1 text-[11px] font-semibold text-amber-900">
          {MOTIVO_CONFLITO_LABEL[linha.motivoConflito]}
        </p>
      )}

      {linha.candidato && (
        <div className="mb-2 rounded-md border bg-white p-2 text-[11px]">
          <p className="font-medium">{linha.candidato.nomeCompleto}</p>
          <p className="text-muted-foreground">
            {linha.candidato.matricula}
            {linha.candidato.cpf ? ` · ${mascararCpf(linha.candidato.cpf)}` : ' · sem CPF'}
            {` · ${linha.candidato.situacao}`}
          </p>
          {linha.candidato.vinculos.map((v, i) => (
            <p key={i} className="text-muted-foreground">
              {v.empresa}
              {v.matricula ? ` — mat. ${v.matricula}` : ''}
              {v.cargo ? ` — ${v.cargo}` : ''}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {linha.candidatoId && (
          <Button size="sm" className="h-7 text-[11px]" onClick={() => onDecidir('MESMA_PESSOA')}>
            É a mesma pessoa
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 text-[11px]"
          onClick={() => onDecidir('PESSOA_DIFERENTE')}>
          Pessoa diferente
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-[11px]"
          onClick={() => onDecidir('IGNORAR')}>
          Deixar de fora
        </Button>
      </div>
    </div>
  );
}
