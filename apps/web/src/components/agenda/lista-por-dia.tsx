'use client';

import { Clock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Esqueleto } from '@/components/ui/esqueleto';
import { CompromissoCard } from '@/components/agenda/compromisso-card';
import { cn } from '@/lib/utils';
import {
  ehMinha, contagemDoGrupoParaTras,
  type Compromisso, type GrupoDaLista, type JanelaDaAgenda, type StatusCompromisso,
} from '@/lib/agenda';

/**
 * A FORMA DA LISTA ENQUANTO ELA NÃO CHEGA — um cabeçalho de dia e cinco linhas
 * com a coluna da hora. No servidor a largura responde "computador", então o
 * celular veria primeiro o esqueleto do quadro; a página troca por este assim
 * que sabe que a visão é a lista. Sem transform nem escalonamento.
 */
export function EsqueletoDaLista() {
  return (
    <div aria-hidden="true" className="space-y-2">
      <Esqueleto className="h-5 w-40" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-lg border bg-card p-3">
          <Esqueleto className="h-4 w-12 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Esqueleto className={cn('h-4', i % 2 ? 'w-3/5' : 'w-4/5')} />
            <Esqueleto className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * "PRÓXIMAS | ANTERIORES" — as duas metades de Todas.
 *
 * Em ordem crescente, Todas começava 60 dias atrás: o topo era passado fechado
 * e o hoje ficava no meio da lista. Dividir pela direção do tempo resolve sem
 * esconder nada — as duas metades somam exatamente o número da aba.
 */
export function SeletorDaJanela({
  janela, onMudar, adiante, anteriores,
}: {
  janela: JanelaDaAgenda;
  onMudar: (j: JanelaDaAgenda) => void;
  /** Da API nova (`todosAdiante`); sem ele, o botão fica sem número. */
  adiante?: number;
  anteriores?: number;
}) {
  const botao = (valor: JanelaDaAgenda, rotulo: string, n: number | undefined) => {
    const ativo = janela === valor;
    return (
      <button
        type="button"
        aria-pressed={ativo}
        onClick={() => onMudar(valor)}
        className={cn(
          'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors md:min-h-9',
          ativo ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
        )}
      >
        {rotulo}
        {n !== undefined && (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
              ativo ? 'bg-white/20 text-white' : 'bg-muted text-foreground',
            )}
          >
            {n}
          </span>
        )}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Quais atividades de Todas" className="flex rounded-lg border border-input bg-card p-1 md:max-w-sm">
      {botao('adiante', 'Próximas', adiante)}
      {botao('anteriores', 'Anteriores', anteriores)}
    </div>
  );
}

/**
 * "CARREGAR MAIS", COM BOTÃO — nunca rolagem infinita: o calendário mora
 * abaixo da lista e ficaria inalcançável. Na última página o rodapé some, sem
 * "fim da lista" (dizer que acabou é o que o fim da lista já diz).
 *
 * FALHA NA PÁGINA SEGUINTE FALA (14/09/2026). O react-query guarda a página 1
 * quando a 2 falha, então o bloco de erro da tela não aparece, e o botão só
 * voltava de "Carregando…" para "Carregar mais": parecia toque perdido ou lista
 * acabada. A linha diz o que houve, e o mesmo botão tenta de novo.
 */
export function RodapeDaPaginacao({
  mostrando, total, temMais, carregando, erro = false, onCarregarMais,
}: {
  mostrando: number;
  /** Da API nova; sem ele diz só quantas estão à vista. */
  total?: number;
  temMais: boolean;
  carregando: boolean;
  /** A última tentativa de trazer a próxima página falhou. */
  erro?: boolean;
  onCarregarMais: () => void;
}) {
  if (!temMais) return null;
  return (
    <div className="space-y-2 pt-1">
      {erro && !carregando && (
        <p role="alert" className="text-center text-xs text-amber-900 dark:text-amber-200">
          Não deu para carregar mais. Tente de novo.
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground tabular-nums">
        {total !== undefined ? `Mostrando ${mostrando} de ${total}` : `Mostrando ${mostrando}`}
      </p>
      <Button variant="outline" className="h-11 w-full" disabled={carregando} onClick={onCarregarMais}>
        {carregando ? 'Carregando…' : 'Carregar mais'}
      </Button>
    </div>
  );
}

/**
 * A AGENDA COMO LISTA POR DIA — o que tenho hoje e depois, na ordem do tempo.
 *
 * Os grupos chegam prontos de `agruparPorDia` (lib/agenda), que é pura e
 * testada; aqui só se desenha. Cada linha é o MESMO `CompromissoCard` do
 * quadro com `modoLista`: um segundo cartão com ações próprias seria uma
 * segunda implementação de Concluir e Iniciar, e as duas divergiriam.
 *
 * "Minhas primeiro" não vale aqui — quebraria a ordem da hora. A marca "você"
 * continua no cartão.
 */
export function ListaPorDia({
  grupos, vazio, vazioDeHoje, onVerSoParaTras, totalParaTras,
  onAbrir, onEditar, onVerTriagem, onAcao, onConcluir, onCancelar, onRemarcar, onExcluir,
  podeExcluir, podeEditar = false, apontado, meuId, onNovo,
}: {
  grupos: GrupoDaLista<Compromisso>[];
  /** Frase quando não há grupo nenhum (a aba ou o dia sem atividade). */
  vazio: string;
  /** Frase dentro do grupo de Hoje vazio. */
  vazioDeHoje: string;
  /** Leva à aba "Ficaram para trás". Não vem quando a lista já é ela. */
  onVerSoParaTras?: () => void;
  /**
   * Quantas ficaram para trás no recorte inteiro, quando nem todas chegaram
   * (Todas · Próximas com mais páginas). Ver `totalDoGrupoParaTras`.
   */
  totalParaTras?: number;
  onAbrir: (c: Compromisso) => void;
  onEditar: (c: Compromisso) => void;
  onVerTriagem: (atendimentoId: string) => void;
  onAcao: (id: string, status: StatusCompromisso) => void;
  onConcluir: (c: Compromisso) => void;
  onCancelar: (c: Compromisso) => void;
  onRemarcar: (c: Compromisso) => void;
  onExcluir?: (c: Compromisso) => void;
  podeExcluir?: boolean;
  podeEditar?: boolean;
  apontado?: string | null;
  meuId?: string;
  onNovo?: () => void;
}) {
  if (grupos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{vazio}</div>
    );
  }

  return (
    <div className="space-y-4">
      {grupos.map((g) => (
        /*
          O CABEÇALHO FIXO MORA DENTRO DA SEÇÃO: gruda no topo enquanto o dia
          está na tela e sai junto com o último cartão dele. Quem rola é o
          <main> do painel, com padding — daí a margem negativa (cobre a
          lateral) e o fundo quase opaco (o cartão que passa por baixo não
          aparece através dele).

          SEM ALTURA MÍNIMA DE 44 PX NO CABEÇALHO (15/09/2026): ele não é alvo de
          toque, e a 400 px cada dia gastava uma faixa alta só para dizer a data.
          O único alvo é "Ver só essas", que guarda os 44 px com margem negativa
          para não engordar a faixa.
        */
        <section key={g.chave} aria-labelledby={`dia-${g.chave}`} className="space-y-2">
          <h3
            id={`dia-${g.chave}`}
            className={cn(
              'sticky top-0 z-10 -mx-4 flex items-center justify-between gap-2 border-b px-4 py-1.5 text-sm font-semibold backdrop-blur md:-mx-6 md:px-6',
              g.paraTras
                ? // Âmbar, como em todo "ficou para trás" do sistema — nunca vermelho.
                  'border-amber-200 bg-amber-50/95 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/90 dark:text-amber-200'
                : 'bg-cinza-claro/95 dark:bg-background/95',
            )}
          >
            {g.paraTras ? (
              <>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 shrink-0" />
                  {g.rotulo} · <span className="tabular-nums">{contagemDoGrupoParaTras(g.itens.length, totalParaTras)}</span>
                </span>
                {onVerSoParaTras && (
                  <button
                    type="button"
                    onClick={onVerSoParaTras}
                    className="-my-2 min-h-11 shrink-0 px-1 font-medium underline-offset-2 hover:underline"
                  >
                    Ver só essas
                  </button>
                )}
              </>
            ) : (
              <>
                <span>{g.rotulo}</span>
                {g.itens.length > 0 && (
                  <span className="rounded bg-muted px-1.5 text-[11px] tabular-nums text-foreground">{g.itens.length}</span>
                )}
              </>
            )}
          </h3>

          {g.itens.map((c) => (
            <CompromissoCard
              key={c.id}
              c={c}
              modoLista
              // No grupo âmbar os dias se misturam: a data continua na linha.
              mostrarData={g.paraTras}
              apontado={apontado === c.id}
              minha={ehMinha(c, meuId)}
              podeEditar={podeEditar}
              onAbrir={onAbrir}
              onEditar={onEditar}
              onVerTriagem={onVerTriagem}
              onAcao={onAcao}
              onConcluir={onConcluir}
              onCancelar={onCancelar}
              onRemarcar={onRemarcar}
              onExcluir={onExcluir}
              podeExcluir={podeExcluir}
            />
          ))}

          {/*
            HOJE VAZIO CONVIDA A CADASTRAR — a mesma lição da coluna vazia do
            quadro: uma tela que só diz "não há nada" não pede nada.
          */}
          {g.hoje && g.itens.length === 0 && (
            <div className="flex flex-col items-stretch gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>{vazioDeHoje}</span>
              {podeEditar && onNovo && (
                <Button variant="outline" className="h-11" onClick={onNovo}>
                  <Plus className="h-4 w-4" /> Nova atividade
                </Button>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
