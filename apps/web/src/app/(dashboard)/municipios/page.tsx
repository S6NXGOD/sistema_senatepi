'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, Building2, Gavel, Landmark, Link2, Loader2, RefreshCw, Search, Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import { UFS } from '@/lib/endereco';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { MunicipioDrawer } from '@/components/municipios/municipio-drawer';
import {
  casarCadastrosComIBGE, destaquesDeEntes, listarMunicipios, numeroBR,
  pendenciasDeMunicipio, percentualBR,
  SITUACAO_FISCAL, sincronizarSiconfi, type MunicipioLinha,
} from '@/lib/municipios';

/**
 * MUNICÍPIOS E INDICADORES PÚBLICOS.
 *
 * POR QUE ESTA TELA EXISTE. Quase toda contraparte do sindicato é um município:
 * ele emprega o filiado, figura como réu no processo e é com ele que se negocia.
 * Até aqui o sistema guardava essa contraparte como TEXTO — sete grafias de
 * Teresina conviviam no cadastro. Agora ela tem código do IBGE, e junto vêm os
 * números que o próprio município declarou ao Tesouro.
 *
 * A ABERTURA PADRÃO É "ONDE O SINDICATO ESTÁ", e não o catálogo inteiro. São
 * 5.571 municípios no Brasil e 72 onde há filiado, organização ou processo.
 * Abrir em 5.571 seria abrir numa lista de nomes sem relação com o trabalho —
 * quem quiser o Brasil todo desmarca uma caixa.
 *
 * A COLUNA QUE IMPORTA É A DA LRF. Acima do limite prudencial o município está
 * proibido por lei de conceder aumento; abaixo, não está. É a resposta que a
 * mesa de negociação começa perguntando.
 */
export default function MunicipiosPage() {
  const { user } = useAuth();
  const podeMexer = podeEditar(user?.role, user?.permissoes, 'municipios');
  const qc = useQueryClient();

  const [busca, setBusca] = useState('');
  const [aplicado, setAplicado] = useState('');
  const [uf, setUf] = useState('');
  const [soComVinculo, setSoComVinculo] = useState(true);
  const [soAcimaDoLimite, setSoAcimaDoLimite] = useState(false);
  const [page, setPage] = useState(1);
  const [abrindo, setAbrindo] = useState<MunicipioLinha | null>(null);
  const [trabalhando, setTrabalhando] = useState<'siconfi' | 'casar' | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['municipios', aplicado, uf, soComVinculo, soAcimaDoLimite, page],
    queryFn: () =>
      listarMunicipios({ busca: aplicado, uf, soComVinculo, soAcimaDoLimite, page, pageSize: 25 }),
    placeholderData: (anterior) => anterior,
  });

  const { data: pend } = useQuery({
    queryKey: ['municipios', 'pendencias'],
    queryFn: pendenciasDeMunicipio,
  });

  /**
   * O ESTADO E A UNIÃO vêm por fora da paginação — ver `destaquesDeEntes`.
   * Para um sindicato da enfermagem do Piauí o Governo do Estado não é mais um
   * item de uma lista: é o segundo maior empregador da base (42 vínculos, 19
   * deles no Hospital Getúlio Vargas) e tem teto de LRF diferente do municipal.
   */
  const { data: destaques } = useQuery({
    queryKey: ['municipios', 'destaques'],
    queryFn: destaquesDeEntes,
  });

  function aplicarBusca() {
    setAplicado(busca.trim());
    setPage(1);
  }

  async function atualizarDoTesouro() {
    setTrabalhando('siconfi');
    try {
      const r = await sincronizarSiconfi();
      toast.success(
        r.municipios === 0
          ? 'Todos os indicadores já estavam atualizados.'
          : `${r.municipios} entes consultados: ${r.comPessoal} com despesa de pessoal, ${r.semPublicacao} não publicaram no período.`,
      );
      qc.invalidateQueries({ queryKey: ['municipios'] });
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível falar com o Tesouro Nacional.');
    } finally {
      setTrabalhando(null);
    }
  }

  async function casarCadastros() {
    setTrabalhando('casar');
    try {
      const r = await casarCadastrosComIBGE();
      toast.success(
        `${r.filiados.ligados} filiados e ${r.organizacoes.ligados} organizações ligados ao IBGE.` +
          (r.filiados.semResolver ? ` ${r.filiados.semResolver} ficaram para conferência.` : ''),
      );
      qc.invalidateQueries({ queryKey: ['municipios'] });
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível casar os cadastros.');
    } finally {
      setTrabalhando(null);
    }
  }

  const itens = data?.items ?? [];

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------- cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Landmark className="h-6 w-6 shrink-0 text-brand-800 dark:text-brand-400" />
            Municípios
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Catálogo do IBGE com os indicadores que o município declarou ao Tesouro Nacional.
          </p>
        </div>
        {podeMexer && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={casarCadastros}
              disabled={trabalhando !== null}
              title="Reconhece o município por trás da cidade digitada no cadastro"
            >
              {trabalhando === 'casar' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" />
              )}
              Ligar cadastros
            </Button>
            <Button
              onClick={atualizarDoTesouro}
              disabled={trabalhando !== null}
              title="Busca no SICONFI os indicadores dos entes onde o sindicato atua. Leva alguns minutos."
            >
              {trabalhando === 'siconfi' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Atualizar do Tesouro
            </Button>
          </div>
        )}
      </div>

      {/*
        A PENDÊNCIA APARECE COMO UMA LINHA, e só quando existe. Um bloco fixo
        dizendo "0 pendências" gasta uma dobra para não informar nada; e esconder
        que 20 filiados moram numa cidade que o sistema não soube identificar
        seria fingir que o casamento fechou.
      */}
      {pend && pend.filiadosSemMunicipio.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0">
            <strong className="font-semibold">
              {pend.filiadosSemMunicipio.reduce((a, p) => a + p.quantos, 0)} filiados
            </strong>{' '}
            com cidade que não bate com o catálogo do IBGE:{' '}
            <span className="text-muted-foreground">
              {pend.filiadosSemMunicipio
                .slice(0, 4)
                .map((p) => `${p.cidade}${p.estado ? '/' + p.estado : ''} (${p.quantos})`)
                .join(', ')}
              {pend.filiadosSemMunicipio.length > 4 ? '…' : ''}
            </span>
          </span>
        </div>
      )}

      {/* ------------------------------------------- Estado e União, fixos */}
      {destaques && destaques.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {destaques.map((e) => (
            <button
              key={e.codigo}
              type="button"
              onClick={() => setAbrindo(e)}
              className="flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition hover:bg-muted/40"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
                <Landmark className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {e.esfera === 'U' ? e.nome : `Governo do Estado — ${e.nome}`}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <SeloFiscal m={e} />
                </div>
                {/*
                  O TETO DO ESTADO É OUTRO (49% da receita, contra 54% do
                  município). Sem dizer isso, quem comparasse os dois números
                  lado a lado tiraria a conclusão errada.
                */}
                {e.esfera === 'E' && e.fiscal.limiteMaximo != null && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Teto estadual de {percentualBR(e.fiscal.limiteMaximo)} — o municipal é outro.
                  </p>
                )}
                <Presenca m={e} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* --------------------------------------------------------- filtros */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && aplicarBusca()}
              placeholder="Buscar município…"
              className="pl-8"
            />
          </div>
          <select
            value={uf}
            onChange={(e) => {
              setUf(e.target.value);
              setPage(1);
            }}
            aria-label="Estado"
            className="h-12 rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
          >
            <option value="">Todos os estados</option>
            {UFS.map((u) => (
              <option key={u.sigla} value={u.sigla}>
                {u.sigla} — {u.nome}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={aplicarBusca} className="sm:w-auto">
            Buscar
          </Button>
        </CardContent>
        <CardContent className="flex flex-wrap gap-x-4 gap-y-2 border-t p-3 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={soComVinculo}
              onChange={(e) => {
                setSoComVinculo(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4"
            />
            Só onde o sindicato atua
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={soAcimaDoLimite}
              onChange={(e) => {
                setSoAcimaDoLimite(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4"
            />
            Só quem está no limite da LRF
          </label>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- lista */}
      {error ? (
        <FalhaAoCarregar erro={error} onTentarDeNovo={refetch} oQue="os municípios" />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-brand-800 dark:text-brand-400" />
        </div>
      ) : itens.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {aplicado || uf || soAcimaDoLimite
                ? 'Nenhum município com esses filtros.'
                : 'O catálogo do IBGE ainda não foi carregado nesta instalação.'}
            </p>
            {soComVinculo && !aplicado && (
              <Button variant="ghost" className="mt-2" onClick={() => setSoComVinculo(false)}>
                Ver o catálogo inteiro
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          {/* ------ desktop ------ */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Município</th>
                  <th className="px-3 py-2 font-semibold">Despesa com pessoal</th>
                  <th className="px-3 py-2 font-semibold">Saúde</th>
                  <th className="px-3 py-2 text-right font-semibold">O sindicato ali</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((m) => (
                  <tr
                    key={m.codigo}
                    onClick={() => setAbrindo(m)}
                    className="cursor-pointer transition hover:bg-muted/40"
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium">
                        {m.nome} <span className="text-muted-foreground">{m.uf}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.populacao ? `${numeroBR(m.populacao)} hab.` : `IBGE ${m.codigo}`}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <SeloFiscal m={m} />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {m.saude?.percentualDespesa != null ? (
                        percentualBR(m.saude.percentualDespesa)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Presenca m={m} alinharDireita />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ------ mobile ------ */}
          <ul className="divide-y md:hidden">
            {itens.map((m) => (
              <li key={m.codigo}>
                <button
                  type="button"
                  onClick={() => setAbrindo(m)}
                  className="w-full px-3 py-3 text-left transition hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {m.nome} <span className="text-muted-foreground">{m.uf}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.populacao ? `${numeroBR(m.populacao)} hab.` : `IBGE ${m.codigo}`}
                        {m.saude?.percentualDespesa != null
                          ? ` · saúde ${percentualBR(m.saude.percentualDespesa)}`
                          : ''}
                      </p>
                    </div>
                    <SeloFiscal m={m} />
                  </div>
                  <Presenca m={m} />
                </button>
              </li>
            ))}
          </ul>

          {/* ------ paginação ------ */}
          {data && data.totalPaginas > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
              <span className="text-muted-foreground">
                {data.total.toLocaleString('pt-BR')} municípios
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Anterior
                </Button>
                <span className="tabular-nums">
                  {data.page} de {data.totalPaginas}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.totalPaginas}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {abrindo && <MunicipioDrawer municipio={abrindo} onFechar={() => setAbrindo(null)} />}
    </div>
  );
}

/**
 * O SELO diz o percentual E o que ele significa. Só o número obrigaria quem lê
 * a lembrar de cor que o teto é 54% e o prudencial 51,3% — e esses limites
 * mudam conforme o poder e a esfera.
 */
function SeloFiscal({ m }: { m: MunicipioLinha }) {
  const est = SITUACAO_FISCAL[m.fiscal.situacao];
  const temNumero = m.fiscal.percentualRcl != null && m.fiscal.situacao !== 'INCONSISTENTE';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold',
        est.cor,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', est.ponto)} aria-hidden />
      {temNumero ? (
        <>
          <span className="tabular-nums">{percentualBR(m.fiscal.percentualRcl)}</span>
          <span className="font-normal">· {est.curto}</span>
        </>
      ) : (
        est.curto
      )}
    </span>
  );
}

/** Filiados, organizações e processos — só o que existe vira chip. */
function Presenca({ m, alinharDireita }: { m: MunicipioLinha; alinharDireita?: boolean }) {
  const chips = [
    { icone: Users, n: m.vinculos.filiados, titulo: 'filiados' },
    { icone: Building2, n: m.vinculos.organizacoes, titulo: 'organizações' },
    { icone: Gavel, n: m.vinculos.processos, titulo: 'processos que tramitam aqui' },
  ].filter((c) => c.n > 0);

  if (!chips.length) {
    return alinharDireita ? (
      <span className="block text-right text-xs text-muted-foreground">—</span>
    ) : null;
  }

  return (
    <div
      className={cn(
        'mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground',
        alinharDireita && 'mt-0 justify-end',
      )}
    >
      {chips.map((c) => (
        <span key={c.titulo} className="inline-flex items-center gap-1" title={c.titulo}>
          <c.icone className="h-3.5 w-3.5" />
          <span className="tabular-nums">{c.n}</span>
        </span>
      ))}
    </div>
  );
}
