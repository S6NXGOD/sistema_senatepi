'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  X, Loader2, Gavel, Users, Building2, Landmark, Pencil, GitMerge, ExternalLink, Scale,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getParteExterna, formatDocumento, TIPO_PARTE_LABEL, type ParteExterna } from '@/lib/partes';
import { formatNPU, STATUS_PROCESSO_LABEL, STATUS_PROCESSO_COR, type StatusProcesso } from '@/lib/processos';
import { V } from '@/lib/vocabulario';

const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/**
 * O DOSSIÊ DA ORGANIZAÇÃO — tudo que está pendurado nela, num lugar só.
 *
 * A API já calculava isto (processos, valor total em causa, resumo por status)
 * e a tela JOGAVA FORA: a listagem era uma lista chapada com editar e
 * desativar, e não havia como abrir uma organização. O trabalho aqui é sobretudo
 * de exibição do que já existia.
 *
 * A PERGUNTA QUE ESTA TELA RESPONDE não é "quais são os dados cadastrais" — é
 * "o que acontece se eu mexer nisto?". Um hospital pode ser réu em quatro ações,
 * empregador de trezentos filiados e contribuinte patronal ao mesmo tempo, e as
 * três coisas apontam para a MESMA linha do banco. Quem vai desativar, mesclar
 * ou corrigir precisa ver os três antes, senão está chutando.
 *
 * Por isso o cabeçalho mostra os números primeiro e o cadastro depois: o risco
 * vem antes do detalhe.
 */
export function OrganizacaoDrawer({
  parte,
  onFechar,
  onEditar,
  onMesclar,
}: {
  parte: ParteExterna;
  onFechar: () => void;
  onEditar?: () => void;
  /** Só ADMINISTRADOR — a mesclagem apaga um cadastro. */
  onMesclar?: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['organizacao', parte.id],
    queryFn: () => getParteExterna(parte.id),
  });

  const r = data?.resumo;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar}>
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              {parte.tipo === 'ORGAO_PUBLICO'
                ? <Landmark className="h-5 w-5 text-brand-800 dark:text-brand-400" />
                : <Building2 className="h-5 w-5 text-brand-800 dark:text-brand-400" />}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold">{parte.nome}</h3>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{TIPO_PARTE_LABEL[parte.tipo]}</span>
                {parte.documento && <span>· {formatDocumento(parte.documento)}</span>}
                {parte.cidade && <span>· {[parte.cidade, parte.uf].filter(Boolean).join(' - ')}</span>}
                {data?.institucional && (
                  <span className="rounded-full bg-brand-100 px-1.5 py-0.5 font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
                    o próprio sindicato
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onMesclar && (
              <Button variant="outline" size="sm" onClick={onMesclar} title="Mesclar uma organização duplicada dentro desta">
                <GitMerge className="h-4 w-4" /> Mesclar
              </Button>
            )}
            {onEditar && (
              <Button variant="outline" size="sm" onClick={onEditar}>
                <Pencil className="h-4 w-4" /> Editar
              </Button>
            )}
            <button type="button" onClick={onFechar} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {isLoading || !data ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {/* NÚMEROS PRIMEIRO — é o que responde "o que está preso aqui?". */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi rotulo="Processos" valor={r!.processos} icone={<Gavel className="h-3.5 w-3.5" />} />
              <Kpi rotulo="Como réu" valor={r!.comoReu} destaque={r!.comoReu > 0} />
              <Kpi rotulo={V.filiados} valor={r!.filiadosVinculados} icone={<Users className="h-3.5 w-3.5" />} />
              <Kpi
                rotulo="Em causa"
                texto={r!.valorTotalEmCausa > 0 ? moeda(r!.valorTotalEmCausa) : '—'}
              />
            </div>

            {/*
              O VÍNCULO COM O PATRONAL, quando existe.
              É o aviso mais importante antes de mexer: aqui há contribuição
              lançada no caixa e credencial de acesso ao portal. A mesclagem
              recusa juntar duas organizações que tenham isto dos dois lados, e
              quem está olhando precisa saber disso ANTES de tentar.
            */}
            {data.dossiePatronal && (
              <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950/30">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-sky-900 dark:text-sky-300">
                  <Building2 className="h-4 w-4 shrink-0" /> Contribuinte patronal
                </p>
                <p className="mt-0.5 text-xs text-sky-900/80 dark:text-sky-200/80">
                  Esta organização também tem dossiê no módulo Patronal, com contribuições e
                  acesso ao portal
                  {data.dossiePatronal.primeiroAcesso ? ' (ainda não acessado)' : ''}.
                  Mexer no cadastro daqui muda o que aparece lá.
                </p>
                <Link
                  href="/empresas"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-sky-800 hover:underline dark:text-sky-300"
                >
                  Abrir no Patronal <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            )}

            {/* PROCESSOS */}
            <Secao titulo="Processos" contagem={data.participacoes.length}>
              {data.participacoes.length === 0 ? (
                <Vazio texto="Esta organização ainda não figura em nenhum processo." />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {data.participacoes.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 p-2.5">
                      <div className="min-w-0">
                        <Link
                          href={`/processos?processo=${p.processo.id}`}
                          className="block truncate font-mono text-[13px] font-medium text-brand-800 hover:underline dark:text-brand-400"
                        >
                          {p.processo.numeroCNJ ? formatNPU(p.processo.numeroCNJ) : 'sem número'}
                        </Link>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {p.processo.classeProcessual ?? 'Classe não informada'}
                          {p.processo.tribunal ? ` · ${p.processo.tribunal}` : ''}
                          {p.papel ? ` · ${p.papel}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                            p.polo === 'PASSIVO'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                          )}
                        >
                          {p.polo === 'PASSIVO' ? 'Réu' : 'Autor'}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            STATUS_PROCESSO_COR[p.processo.statusInterno as StatusProcesso],
                          )}
                        >
                          {STATUS_PROCESSO_LABEL[p.processo.statusInterno as StatusProcesso]}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>

            {/* FILIADOS QUE TRABALHAM AQUI */}
            <Secao titulo={`${V.filiados} que trabalham aqui`} contagem={r!.filiadosVinculados}>
              {data.vinculos.length === 0 ? (
                <Vazio texto={`Nenhum ${V.filiado} tem vínculo de trabalho com esta organização.`} />
              ) : (
                <>
                  <ul className="divide-y rounded-lg border">
                    {data.vinculos.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-3 p-2.5">
                        <div className="min-w-0">
                          <Link
                            href={`/filiados?filiado=${v.filiado?.id ?? ''}`}
                            className="block truncate text-[13px] font-medium text-brand-800 hover:underline dark:text-brand-400"
                          >
                            {v.filiado?.nomeCompleto ?? '—'}
                          </Link>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {[v.cargo, v.lotacao, v.matricula && `mat. ${v.matricula}`]
                              .filter(Boolean)
                              .join(' · ') || 'Sem cargo informado'}
                          </p>
                        </div>
                        {v.descontoEmFolha && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            desconto em folha
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {/* Sem este aviso a amostra passaria por lista completa, e a
                      pessoa concluiria que só há 8 pessoas no hospital. */}
                  {r!.filiadosVinculados > data.vinculos.length && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Mostrando {data.vinculos.length} de {r!.filiadosVinculados} —
                      a lista completa está em {V.filiados}, filtrando por local de trabalho.
                    </p>
                  )}
                </>
              )}
            </Secao>

            {parte.observacoes && (
              <Secao titulo="Observações">
                <p className="whitespace-pre-wrap rounded-lg border p-3 text-sm">{parte.observacoes}</p>
              </Secao>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  rotulo, valor, texto, icone, destaque,
}: {
  rotulo: string; valor?: number; texto?: string; icone?: React.ReactNode; destaque?: boolean;
}) {
  return (
    <div className={cn('rounded-lg border p-2.5', destaque && 'border-red-300 dark:border-red-900')}>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">{icone}{rotulo}</p>
      <p className={cn('text-lg font-bold tabular-nums', destaque && 'text-red-700 dark:text-red-400')}>
        {texto ?? valor}
      </p>
    </div>
  );
}

function Secao({
  titulo, contagem, children,
}: { titulo: string; contagem?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {titulo}
        {contagem !== undefined && (
          <span className="rounded-full bg-muted px-1.5 text-xs font-bold tabular-nums text-muted-foreground">
            {contagem}
          </span>
        )}
      </h4>
      {children}
    </section>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <p className="flex items-center gap-1.5 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      <Scale className="h-3.5 w-3.5 shrink-0 opacity-60" /> {texto}
    </p>
  );
}
