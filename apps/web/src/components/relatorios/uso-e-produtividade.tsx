'use client';

import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CalendarCheck, Gavel, Headset, Newspaper, UserPlus, type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { Carregando, Esqueleto, EsqueletoCartoes } from '@/components/ui/esqueleto';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PERFIL_LABEL, podeVer } from '@/lib/permissoes';
import { contar } from '@/lib/plural';
import {
  GRUPO_DO_PERFIL, O_QUE_NAO_MEDE, TITULO_DO_BLOCO, agoraDaPessoa, blocosDaPessoa,
  carregarProdutividade, conteudoDoBloco, criadaNoPeriodo, diaEMes, diaMesEAno, faixaDeUso, fraseDoPerfil,
  gruposPorPerfil, hrefDaAuditoria, legendaDaAba, textoDosDiasComUso,
  type Bloco, type LinhaDeUso, type Produtividade, type ResumoDoPerfil,
} from '@/lib/produtividade';

/**
 * USO E PRODUTIVIDADE — a aba de quem coordena.
 *
 * Grupos por perfil, pessoas em ordem alfabética, e nenhuma medalha: a ordem
 * vem da API e a tela não reordena. Cada pessoa é um cartão em DUAS ZONAS, as
 * mesmas do PDF (15/09/2026):
 *
 *  1. NO PERÍODO — a faixa dos dias e o que registrou, sem âmbar: o período
 *     escolhido não pede nada;
 *  2. AGORA — último acesso, o que está em aberto e atrasado, as propostas
 *     esperando decisão. É o único lugar com âmbar.
 *
 * O cartão dizia "0 concluídas · 4 em aberto, 2 atrasadas" no mesmo quadro: o
 * atraso de hoje parecia do mês, e o zero do mês parecia a causa dele. O texto
 * de cada número é a frase curta da legenda, a mesma do "O que conta" do PDF.
 * "Ver o que fez" abre a auditoria já filtrada.
 */
export function UsoEProdutividade({ de, ate }: { de: string; ate: string }) {
  const { user } = useAuth();
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['produtividade', de, ate],
    queryFn: () => carregarProdutividade(de, ate),
    placeholderData: keepPreviousData,
  });
  const verAuditoria = podeVer(user?.role, user?.permissoes, 'auditoria');

  if (isLoading) {
    return (
      <Carregando texto="Somando o uso do período…" className="space-y-6">
        <EsqueletoCartoes quantidade={4} className="gap-2 sm:grid-cols-2 lg:grid-cols-4 [&>div]:h-[88px]" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <Esqueleto className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Esqueleto className="h-3.5 w-2/5" />
                  <Esqueleto className="h-3 w-1/4" />
                </div>
              </div>
              <Esqueleto className="h-4 w-full" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Esqueleto className="h-20" />
                <Esqueleto className="h-20" />
                <Esqueleto className="hidden h-20 sm:block" />
              </div>
              <Esqueleto className="h-16 w-full" />
            </div>
          ))}
        </div>
      </Carregando>
    );
  }
  // Falha não vira cartão zerado: zero afirmaria que ninguém trabalhou.
  if (isError) {
    return (
      <Card className="p-2">
        <FalhaAoCarregar erro={error} oQue="o uso do sistema" onTentarDeNovo={() => refetch()} />
      </Card>
    );
  }
  if (!data) return null;

  // "Agora" é o instante em que a API somou — foi contra ele que ela contou as ausências.
  const agora = new Date(data.geradoEm);
  const pessoal = data.escopo === 'PESSOAL';

  return (
    /*
      A troca de aba entra num fade curto, AQUI na raiz, e não na chamada da
      página. O fade mora num invólucro próprio para não somar com o
      `opacity-60` do "atualizando" logo abaixo.
    */
    <div className="animate-surgir-leve">
    <div className={cn('space-y-6 transition-opacity', isFetching && 'opacity-60')}>
      {pessoal ? (
        <p className="max-w-3xl text-sm text-muted-foreground">
          O seu uso do sistema no período — é o mesmo retrato que a coordenação vê de você.
        </p>
      ) : (
        <ResumoDosPerfis perfis={data.perfis} />
      )}

      {gruposPorPerfil(data.pessoas).map((g) => (
        <section key={g.perfil} id={`perfil-${g.perfil}`} className="scroll-mt-20 space-y-3">
          {!pessoal && (
            <h2 className="flex items-baseline gap-2 text-base font-semibold">
              {GRUPO_DO_PERFIL[g.perfil] ?? g.perfil}
              <span className="text-xs font-normal text-muted-foreground">
                {contar(g.pessoas.length, 'pessoa', 'pessoas')}
              </span>
            </h2>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {g.pessoas.map((p) => (
              <CartaoDaPessoa
                key={p.usuarioId}
                p={p}
                dias={data.dias}
                agora={agora}
                hrefAuditoria={verAuditoria ? hrefDaAuditoria(p.usuarioId, de, ate) : null}
              />
            ))}
          </div>
        </section>
      ))}

      <ComoLer escopo={data.escopo} />

      <p className="max-w-3xl border-t pt-3 text-[11px] leading-snug text-muted-foreground">
        {O_QUE_NAO_MEDE}
      </p>
    </div>
    </div>
  );
}

const ZONAS_DA_LEGENDA = [
  { retrato: 'PERIODO', titulo: 'No período' },
  { retrato: 'HOJE', titulo: 'Agora' },
] as const;

/**
 * COMO LER ESTES NÚMEROS — a legenda inteira, recolhida, nas mesmas duas zonas
 * do cartão (15/09/2026): o que é do período escolhido e o que é de agora.
 */
function ComoLer({ escopo }: { escopo: Produtividade['escopo'] }) {
  const legenda = legendaDaAba(escopo);
  return (
    <details className="group max-w-3xl rounded-xl border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Como ler estes números
        <span className="text-xs font-normal text-muted-foreground group-open:hidden">Mostrar</span>
        <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">Esconder</span>
      </summary>
      {ZONAS_DA_LEGENDA.map((zona) => (
        <div key={zona.retrato} className="border-t">
          <h3 className="bg-muted/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {zona.titulo}
          </h3>
          <dl className="divide-y">
            {legenda
              .filter((l) => l.retrato === zona.retrato)
              .map((l) => (
                <div key={l.chave} className="px-4 py-2.5">
                  <dt className="text-sm font-medium">{l.numero}</dt>
                  <dd className="mt-0.5 text-xs leading-snug text-muted-foreground">{l.conta}</dd>
                </div>
              ))}
          </dl>
        </div>
      ))}
    </details>
  );
}

/**
 * UMA LINHA POR PERFIL, antes dos cartões: quantos usaram e quantos sumiram.
 * Responde "a equipe está usando?" sem rolar a página — e o toque desce até o
 * grupo.
 */
function ResumoDosPerfis({ perfis }: { perfis: ResumoDoPerfil[] }) {
  if (!perfis.length) return null;
  return (
    <nav
      aria-label="Resumo por perfil"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4"
    >
      {perfis.map((r) => {
        const sumiram = r.semAcessoRecente + r.nuncaEntraram > 0;
        return (
          <a
            key={r.perfil}
            href={`#perfil-${r.perfil}`}
            className="w-44 shrink-0 rounded-xl border bg-card p-3 transition hover:bg-muted/40 sm:w-auto"
          >
            <p className="text-xs text-muted-foreground">{GRUPO_DO_PERFIL[r.perfil] ?? r.perfil}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {r.usaram}
              <span className="ml-1 text-sm font-normal text-muted-foreground">de {r.pessoas} usaram</span>
            </p>
            <p
              className={cn(
                'mt-0.5 text-[11px] leading-snug',
                sumiram ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
              )}
            >
              {fraseDoPerfil(r)}
            </p>
          </a>
        );
      })}
    </nav>
  );
}

/** O nome da zona, pequeno, em cima dela. */
function RotuloDaZona({ children }: { children: string }) {
  return <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function CartaoDaPessoa({
  p, dias, agora, hrefAuditoria,
}: {
  p: LinhaDeUso;
  dias: string[];
  agora: Date;
  hrefAuditoria: string | null;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <AvatarPessoa nome={p.nome} url={p.avatarUrl} tamanho="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{p.nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {(PERFIL_LABEL as Record<string, string>)[p.perfil] ?? p.perfil}
          </p>
        </div>
      </div>

      <section aria-label="No período" className="space-y-2">
        <RotuloDaZona>No período</RotuloDaZona>
        <FaixaDosDias
          dias={dias}
          ativos={p.diasAtivos}
          total={p.diasComUso}
          desde={criadaNoPeriodo(p.contaCriadaEm, dias)}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {blocosDaPessoa(p).map((b) => (
            <QuadroDoBloco key={b} bloco={b} p={p} dias={dias} />
          ))}
        </div>
      </section>

      <AgoraDaPessoa p={p} agora={agora} />

      {hrefAuditoria && (
        <Link
          href={hrefAuditoria}
          className="inline-flex min-h-11 items-center gap-1 self-start text-xs font-medium text-brand-800 hover:underline sm:min-h-0 dark:text-brand-300"
        >
          Ver o que fez no período <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </Card>
  );
}

/**
 * AGORA — os mesmos itens da caixa "Agora" do PDF (`agoraDaPessoa`), e o
 * único âmbar do cartão. Uma linha por item, com o rótulo à esquerda e o valor
 * à direita; a 400 px o valor desce para baixo do rótulo quando não cabe.
 */
function AgoraDaPessoa({ p, agora }: { p: LinhaDeUso; agora: Date }) {
  return (
    <section aria-label="Agora" className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <RotuloDaZona>Agora</RotuloDaZona>
      <dl className="mt-1.5 space-y-1.5">
        {agoraDaPessoa(p, agora).map((item) => (
          <div key={item.chave} title={item.explica} className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
            <dt className="text-muted-foreground">{item.rotulo}</dt>
            <dd className="text-right">
              <span className={cn('font-medium', item.alerta && 'text-amber-700 dark:text-amber-400')}>
                {item.valor}
              </span>
              {item.abaixo && (
                <span
                  className={cn(
                    'ml-1.5 font-semibold',
                    item.abaixo.alerta ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                  )}
                >
                  {item.abaixo.texto}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function tomDaSemana(comUso: number, total: number): string {
  if (!comUso) return 'bg-muted';
  const proporcao = comUso / total;
  if (proporcao >= 0.7) return 'bg-brand-600 dark:bg-brand-400';
  if (proporcao >= 0.4) return 'bg-brand-400 dark:bg-brand-600';
  return 'bg-brand-200 dark:bg-brand-800';
}

/**
 * A FAIXA DOS DIAS — um traço por dia, cheio quando a pessoa usou o sistema.
 * Fim de semana é mais claro: ninguém deve nada ao sábado, e a faixa não pode
 * sugerir o contrário.
 *
 * CONTA CRIADA NO MEIO DO PERÍODO (15/09/2026), a mesma regra do PDF: os dias
 * de antes dela saíam cinza, como "não usou", e "o período tem 21 dias de
 * semana" contava dias em que a conta nem existia. Agora viram um trecho só,
 * tracejado, e a frase conta dali ("desde 20/08 são 8 dias de semana"). "A
 * conta foi criada em …" aparece uma vez, embaixo da faixa.
 */
function FaixaDosDias({
  dias, ativos, total, desde,
}: {
  dias: string[];
  ativos: string[];
  total: number;
  /** O dia da criação da conta, quando cai dentro do período (`criadaNoPeriodo`). */
  desde: string | null;
}) {
  const faixa = faixaDeUso(dias, ativos, desde);
  const texto = textoDosDiasComUso(total, dias, desde);
  const antes = faixa.marcas.filter((m) => m.antesDaConta).length;
  // A largura máxima de uma marca (12 ou 16 px) mais o vão de 2 px: o trecho ocupa o lugar das marcas que substitui.
  const passo = faixa.tipo === 'DIA' ? 14 : 18;
  return (
    <div>
      <div
        role="img"
        aria-label={texto}
        className="flex h-4 items-stretch gap-[2px]"
      >
        {antes > 0 && (
          <span
            title="Antes da conta existir"
            className="rounded-[2px] border border-dashed border-muted-foreground/30"
            style={{ flex: `${antes} ${antes} 0%`, maxWidth: `${antes * passo - 2}px`, minWidth: `${antes * 2}px` }}
          />
        )}
        {faixa.tipo === 'DIA'
          ? faixa.marcas.filter((m) => !m.antesDaConta).map((m) => (
              <span
                key={m.dia}
                title={`${diaEMes(m.dia)}${m.usou ? ': usou o sistema' : ''}`}
                className={cn(
                  'min-w-[2px] max-w-3 flex-1 rounded-[2px]',
                  m.usou ? 'bg-brand-600 dark:bg-brand-400' : m.fimDeSemana ? 'bg-muted/40' : 'bg-muted',
                )}
              />
            ))
          : faixa.marcas.filter((m) => !m.antesDaConta).map((m) => (
              <span
                key={m.inicio}
                title={`Semana de ${diaEMes(m.inicio)}: ${m.diasComUso} de ${m.diasNoTrecho} dias`}
                className={cn('min-w-[3px] max-w-4 flex-1 rounded-[2px]', tomDaSemana(m.diasComUso, m.diasNoTrecho))}
              />
            ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {texto}
        {faixa.tipo === 'SEMANA' && ' · cada traço é uma semana'}
      </p>
      {desde && (
        <p className="text-[11px] text-muted-foreground">
          A conta foi criada em {diaMesEAno(desde)}; o tracejado é o tempo antes dela.
        </p>
      )}
    </div>
  );
}

const ICONE_DO_BLOCO: Record<Bloco, LucideIcon> = {
  agenda: CalendarCheck,
  publicacoes: Newspaper,
  processos: Gavel,
  filiados: UserPlus,
  atendimentos: Headset,
};

/** O quadro de um bloco, só com o que é do período — sem cor de alerta. */
function QuadroDoBloco({ bloco, p, dias }: { bloco: Bloco; p: LinhaDeUso; dias: string[] }) {
  const Icone = ICONE_DO_BLOCO[bloco];
  const c = conteudoDoBloco(bloco, p, dias);
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 p-2.5" title={c.explica}>
      <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {TITULO_DO_BLOCO[bloco]}
      </p>
      <p className="mt-1 text-xl font-bold leading-none tabular-nums">{c.numero ?? '—'}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{c.rotulo}</p>
      {c.linhas.map((l) => (
        <p key={l.texto} className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {l.texto}
        </p>
      ))}
    </div>
  );
}
