'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, SlidersHorizontal, Upload, X, ArrowUpDown, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatarData, mascararCpf } from '@/lib/utils';
import {
  Filiado,
  FORMACAO_LABEL,
  ORDENACOES_FILIADO,
  SITUACAO_COR,
  SITUACAO_LABEL,
  SITUACOES,
  type OrdenacaoFiliado,
} from '@/lib/filiados';
import { FiliadoRowActions } from '@/components/filiados/filiado-row-actions';

const VAZIO = { busca: '', coren: '', cidade: '', situacao: '', dataInicio: '', dataFim: '' };
type Filtros = typeof VAZIO;

/** Rótulo de cada filtro nas fichas de "filtros ativos". */
const ROTULO: Record<keyof Filtros, string> = {
  busca: 'Busca',
  coren: 'COREN',
  cidade: 'Cidade',
  situacao: 'Situação',
  dataInicio: 'Filiação a partir de',
  dataFim: 'Filiação até',
};

export default function FiliadosPage() {
  // rascunho = o que está sendo digitado; aplicado = o que de fato consulta a API
  const [rascunho, setRascunho] = useState<Filtros>(VAZIO);
  const [aplicado, setAplicado] = useState<Filtros>(VAZIO);
  // A ordenação NÃO é filtro: "Limpar filtros" não a desfaz, e mudá-la não
  // depende de clicar em "Aplicar". São dois controles com ritmos diferentes.
  const [ordenar, setOrdenar] = useState<OrdenacaoFiliado>('recentes');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['filiados', aplicado, ordenar, page, pageSize],
    queryFn: async () =>
      (await api.get('/filiados', { params: { ...limpar(aplicado), ordenar, page, pageSize } }))
        .data,
    // Mantém a página anterior visível enquanto a próxima carrega, em vez de
    // piscar a tabela inteira para "Carregando..." a cada clique.
    placeholderData: (anterior) => anterior,
  });

  const linhas: Filiado[] | undefined = data?.data;
  const total: number = data?.total ?? 0;
  const totalPages: number = data?.totalPages ?? 1;

  const ativos = (Object.keys(aplicado) as (keyof Filtros)[]).filter((k) => aplicado[k] !== '');
  const temFiltro = ativos.length > 0;

  function setR<K extends keyof Filtros>(k: K, v: string) {
    setRascunho((f) => ({ ...f, [k]: v }));
  }
  function aplicar() {
    setAplicado(rascunho);
    setPage(1);
  }
  function limparTudo() {
    setRascunho(VAZIO);
    setAplicado(VAZIO);
    setPage(1);
  }
  /** Remove UM filtro pela ficha, sem mexer nos outros. */
  function removerFiltro(k: keyof Filtros) {
    const novo = { ...aplicado, [k]: '' };
    setAplicado(novo);
    setRascunho(novo);
    setPage(1);
  }
  function revalidar() {
    queryClient.invalidateQueries({ queryKey: ['filiados'] });
  }

  const primeiro = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const ultimo = Math.min(page * pageSize, total);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Filiados</h2>
          <p className="text-sm text-muted-foreground">
            {temFiltro ? (
              <>
                <strong className="text-foreground">{total.toLocaleString('pt-BR')}</strong>{' '}
                {total === 1 ? 'resultado' : 'resultados'} para os filtros aplicados
              </>
            ) : (
              <>{total.toLocaleString('pt-BR')} associados</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/filiados/importar">
            <Button variant="outline"><Upload className="h-4 w-4" /> Importar CSV</Button>
          </Link>
          <Link href="/filiados/novo">
            <Button><Plus className="h-4 w-4" /> Nova filiação</Button>
          </Link>
        </div>
      </div>

      {/* ---- Busca, ordenação e filtros ---- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              // A busca ignora acento, caixa e ordem das palavras, então o
              // exemplo é escrito de propósito sem acento e com sobrenome
              // solto: é o jeito que as pessoas realmente digitam, e mostrar
              // que funciona vale mais do que uma instrução.
              placeholder="Buscar por nome, CPF, matrícula ou COREN — ex.: maria silva"
              className="pl-10 pr-9"
              value={rascunho.busca}
              onChange={(e) => setR('busca', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }}
            />
            {rascunho.busca && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => { setR('busca', ''); setAplicado((a) => ({ ...a, busca: '' })); setPage(1); }}
                className="absolute right-2 top-2.5 rounded p-0.5 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button onClick={aplicar}><Search className="h-4 w-4" /> Buscar</Button>

          {/* Ordenação à vista. Antes não havia controle nenhum e a ordem era
              um mistério — pior ainda porque, sem desempate no banco, ela
              mudava sozinha entre uma página e outra. */}
          <div className="relative">
            <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <select
              aria-label="Ordenar por"
              className="h-12 rounded-md border border-input bg-background pl-9 pr-3 text-base md:h-10 md:text-sm"
              value={ordenar}
              onChange={(e) => { setOrdenar(e.target.value as OrdenacaoFiliado); setPage(1); }}
            >
              {ORDENACOES_FILIADO.map((o) => (
                <option key={o.valor} value={o.valor}>{o.label}</option>
              ))}
            </select>
          </div>

          <Button
            variant={mostrarFiltros ? 'default' : 'outline'}
            onClick={() => setMostrarFiltros((v) => !v)}
          >
            <SlidersHorizontal className="h-4 w-4" /> Filtros
            {temFiltro && (
              <span className="ml-1 rounded-full bg-senatepi-800 px-1.5 text-xs font-bold text-white dark:bg-senatepi-400 dark:text-senatepi-900">
                {ativos.length}
              </span>
            )}
          </Button>
        </div>

        {/* Fichas dos filtros ativos. Sem isto, fechar o painel escondia o que
            estava filtrado e a contagem parecia simplesmente errada. */}
        {temFiltro && (
          <div className="flex flex-wrap items-center gap-1.5">
            {ativos.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full border border-senatepi-200 bg-senatepi-50 py-1 pl-2.5 pr-1 text-xs text-senatepi-900 dark:border-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-100"
              >
                <span className="opacity-70">{ROTULO[k]}:</span>
                <strong>{valorLegivel(k, aplicado[k])}</strong>
                <button
                  type="button"
                  aria-label={`Remover filtro ${ROTULO[k]}`}
                  onClick={() => removerFiltro(k)}
                  className="rounded-full p-0.5 hover:bg-senatepi-200 dark:hover:bg-senatepi-800"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={limparTudo}
              className="ml-1 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              limpar tudo
            </button>
          </div>
        )}

        {mostrarFiltros && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Campo label="COREN">
                  <Input placeholder="Ex.: 123456" value={rascunho.coren} onChange={(e) => setR('coren', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }} />
                </Campo>
                <Campo label="Cidade">
                  <Input placeholder="Ex.: Teresina" value={rascunho.cidade} onChange={(e) => setR('cidade', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }} />
                </Campo>
                <Campo label="Situação">
                  <select
                    className="h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
                    value={rascunho.situacao}
                    onChange={(e) => setR('situacao', e.target.value)}
                  >
                    <option value="">Todas as situações</option>
                    {SITUACOES.map((s) => <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>)}
                  </select>
                </Campo>
                <Campo label="Filiação a partir de">
                  <Input type="date" value={rascunho.dataInicio} onChange={(e) => setR('dataInicio', e.target.value)} />
                </Campo>
                <Campo label="Filiação até">
                  <Input type="date" value={rascunho.dataFim} onChange={(e) => setR('dataFim', e.target.value)} />
                </Campo>
              </div>
              {/* O intervalo de datas usa a DATA DE FILIAÇÃO. Quem veio da carga
                  legada sem essa informação fica de fora — dizer isso na tela
                  evita a leitura de que "sumiram filiados". */}
              {(rascunho.dataInicio || rascunho.dataFim) && (
                <p className="text-xs text-muted-foreground">
                  O período considera a data de filiação. Quem está sem essa data registrada
                  não aparece no resultado.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={limparTudo}>Limpar</Button>
                <Button size="sm" onClick={aplicar}>Aplicar filtros</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Desktop (>= md): tabela tradicional */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="w-14 px-4 py-3 font-medium"><span className="sr-only">Foto</span></th>
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">CPF</th>
                  <th className="px-4 py-3 font-medium">Matrícula</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 font-medium">Filiação</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && linhas?.map((f: Filiado) => (
                  <tr key={f.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2">
                      {f.fotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.fotoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-senatepi-50 text-xs font-semibold text-senatepi-800">{f.nomeCompleto.charAt(0)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/filiados/${f.id}`} className="hover:underline">
                        {f.nomeCompleto}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{f.cpf ? mascararCpf(f.cpf) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{f.matricula}</td>
                    <td className="px-4 py-3 text-xs">{f.formacao ? FORMACAO_LABEL[f.formacao] : '—'}</td>
                    <td className="px-4 py-3">{f.telefonePrincipal ?? '—'}</td>
                    <td className="px-4 py-3"><Badge className={SITUACAO_COR[f.situacao]}>{SITUACAO_LABEL[f.situacao]}</Badge></td>
                    <td className="px-4 py-3"><DataFiliacao f={f} /></td>
                    <td className="px-4 py-3">
                      <FiliadoRowActions filiado={f} onChanged={revalidar} />
                    </td>
                  </tr>
                ))}
                {!isLoading && linhas && linhas.length === 0 && (
                  <tr><td colSpan={9}><Vazio temFiltro={temFiltro} onLimpar={limparTudo} /></td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile (< md): cards empilhados com os mesmos registros */}
          <div className="divide-y md:hidden">
            {isLoading && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando...</p>
            )}
            {!isLoading && linhas?.map((f: Filiado) => (
              <FiliadoCardMobile key={f.id} f={f} onChanged={revalidar} />
            ))}
            {!isLoading && linhas && linhas.length === 0 && (
              <Vazio temFiltro={temFiltro} onLimpar={limparTudo} />
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- Paginação ----
          Com 7 mil registros, "Anterior/Próxima" sozinhos deixavam a última
          página a 700 cliques de distância. Agora há salto para as pontas, o
          intervalo exibido e o tamanho da página. */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Mostrando <strong className="text-foreground">{primeiro.toLocaleString('pt-BR')}–{ultimo.toLocaleString('pt-BR')}</strong>{' '}
            de {total.toLocaleString('pt-BR')}
          </p>
          <div className="flex items-center gap-2">
            <select
              aria-label="Itens por página"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
            </select>
            {totalPages > 1 && (
              <>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)}>Primeira</Button>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                <span className="px-1 text-sm text-muted-foreground">
                  {page} de {totalPages.toLocaleString('pt-BR')}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Última</Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Data de filiação da linha.
 *
 * A coluna chama-se "Filiação" e até agora mostrava `createdAt` — o carimbo de
 * quando a linha entrou no banco. Para os 1.903 da carga em massa isso exibia
 * 03/07/2026 como se todos tivessem se filiado no mesmo dia, o que não
 * aconteceu. Quando a data verdadeira é desconhecida, a resposta certa é dizer
 * que não se sabe, não preencher com o que estava à mão.
 */
function DataFiliacao({ f }: { f: Filiado }) {
  if (f.dataFiliacao) return <span className="text-muted-foreground">{formatarData(f.dataFiliacao)}</span>;
  return (
    <span
      className="cursor-help text-xs italic text-muted-foreground/70"
      title="Este filiado veio da importação sem a data de filiação. O cadastro está completo; apenas essa data não foi informada."
    >
      não informada
    </span>
  );
}

/** Estado vazio que distingue "não há filiados" de "o filtro não achou nada". */
function Vazio({ temFiltro, onLimpar }: { temFiltro: boolean; onLimpar: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Users className="h-8 w-8 text-muted-foreground/40" />
      {temFiltro ? (
        <>
          <p className="text-sm font-medium">Nenhum filiado corresponde aos filtros</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Tente ampliar o período ou remover algum critério.
          </p>
          <Button variant="outline" size="sm" className="mt-1" onClick={onLimpar}>
            Limpar filtros
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Nenhum filiado cadastrado ainda</p>
          <Link href="/filiados/novo" className="mt-1">
            <Button size="sm"><Plus className="h-4 w-4" /> Nova filiação</Button>
          </Link>
        </>
      )}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/** Card de filiado para o mobile (< md) — mesmo registro da tabela, empilhado. */
function FiliadoCardMobile({ f, onChanged }: { f: Filiado; onChanged: () => void }) {
  return (
    <div className="flex gap-3 p-4">
      {f.fotoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={f.fotoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-senatepi-50 text-sm font-semibold text-senatepi-800">
          {f.nomeCompleto.charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/filiados/${f.id}`} className="min-w-0">
            <p className="truncate font-semibold leading-tight">{f.nomeCompleto}</p>
            <p className="font-mono text-xs text-muted-foreground">{f.matricula}</p>
          </Link>
          <FiliadoRowActions filiado={f} onChanged={onChanged} />
        </div>
        <div className="mt-1.5">
          <Badge className={SITUACAO_COR[f.situacao]}>{SITUACAO_LABEL[f.situacao]}</Badge>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
          <Info label="CPF" valor={f.cpf ? mascararCpf(f.cpf) : '—'} />
          <Info label="Categoria" valor={f.formacao ? FORMACAO_LABEL[f.formacao] : '—'} />
          <Info label="Telefone" valor={f.telefonePrincipal ?? '—'} />
          <Info
            label="Filiação"
            valor={f.dataFiliacao ? formatarData(f.dataFiliacao) : 'não informada'}
          />
        </dl>
      </div>
    </div>
  );
}

function Info({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate">{valor}</dd>
    </div>
  );
}

/** Valor do filtro como a pessoa o entende (código de situação vira rótulo). */
function valorLegivel(chave: keyof Filtros, valor: string): string {
  if (chave === 'situacao') return SITUACAO_LABEL[valor as keyof typeof SITUACAO_LABEL] ?? valor;
  if (chave === 'dataInicio' || chave === 'dataFim') {
    // O input date entrega "YYYY-MM-DD" puro. `new Date()` leria isso como
    // meia-noite UTC, que em Brasília (UTC-3) é 21h do dia ANTERIOR — a ficha
    // exibiria um dia a menos do que a pessoa escolheu. Por isso a conversão
    // é textual, sem passar por Date.
    const [a, m, d] = valor.split('-');
    return d && m && a ? `${d}/${m}/${a}` : valor;
  }
  return valor;
}

function limpar<T extends Record<string, string>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '')) as Partial<T>;
}
