'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ChevronRight, Gavel, Newspaper, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { avisosDaFaixa, frasePlena, minhasPendencias, type TipoPendencia } from '@/lib/pendencias';

/**
 * A FAIXA DE AVISOS — o único aviso que aparece em toda tela.
 *
 * TRÊS REGRAS QUE A IMPEDEM DE VIRAR RUÍDO:
 *
 *  1. Só o que não pode esperar: o que é seu e ficou para trás, a publicação que
 *     nunca virou tarefa, a tarefa da sua equipe sem ninguém cuidando e o ato do
 *     tribunal que ninguém decidiu. O dia de hoje e a audiência da semana moram
 *     no painel. Faixa que aparece todo dia é cabeçalho, e cabeçalho ninguém lê.
 *
 *     O QUARTO ENTROU EM 17/09/2026, no lugar de uma tarefa. O robô do DataJud
 *     abria "Verificação de Intimação / Prazo" sem saber o que o juízo pediu —
 *     32 das 48 foram canceladas. "Se for algo urgente, mande um alerta, mas não
 *     encha de tarefas desnecessárias": o ato passou a ser aviso, e aviso some
 *     quando alguém decide, sem entulhar a agenda de ninguém.
 *  2. NÃO tem botão de fechar. Ela some quando o trabalho é feito, porque é
 *     estado derivado — fechar ensinaria que dá para calar o aviso sem resolver.
 *  3. Âmbar, sem repreender ninguém. Um item só leva ao próprio item e diz qual
 *     é; vários levam à lista do grupo.
 *
 * ERA A IRMÃ DO SINO, que saiu em 12/09/2026 por repetir o painel numa gaveta
 * que ninguém abria. Ficou só ela — e por isso passou a dizer QUAL é a coisa, e
 * não só quantas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UMA LINHA POR AVISO, EMPILHADAS — 18/09/2026, e não é gosto.
 *
 * "Essa barra amarela que aparece em cima me pareceu grosseira e amadora." Era,
 * e o desenho escondia coisa:
 *
 *  · os avisos 2..N eram `shrink-0` sem `truncate` e sem `min-w-0`, numa linha
 *    `flex` sem `flex-wrap` dentro de um contêiner que corta o que transborda.
 *    Entre 1024px e ~1500px o texto sumia inteiro — sem reticências, sem rolagem
 *    e sem nada que dissesse que havia mais;
 *  · a pastilha "+N" que salvaria o celular era `lg:hidden`, ou seja, existia
 *    exatamente onde o corte NÃO acontecia;
 *  · e ela levava a `/dashboard`, prometendo no painel avisos que o painel não
 *    tem — o ato do tribunal só existe na ficha do processo;
 *  · o ícone era o do PRIMEIRO grupo, para a faixa toda. Como o serviço começa
 *    sempre por ATRASADA, era sempre o mesmo, e as naturezas viravam uma só.
 *
 * Empilhar resolve os quatro de uma vez: cada aviso é uma linha inteira, com o
 * seu ícone e o seu destino, e o desenho é o mesmo a 400px e a 1440px. São no
 * máximo quatro grupos — na produção de 18/09/2026, cinco atividades atrasadas
 * no sindicato inteiro, entre três pessoas —, então a faixa mede uma a três
 * linhas quase sempre, e some quando o trabalho é feito.
 *
 * NADA É ESCONDIDO POR LARGURA. Não há `hidden` de responsividade em aviso
 * nenhum: o que corta é `truncate`, que deixa reticências, e o `title` do link
 * carrega a frase inteira.
 *
 * ELA FALA SOZINHA. A consulta se repete a cada 60s; um aviso que nascia com a
 * pessoa na tela aparecia mudo. A região é `role="status"`, e existe no DOM
 * mesmo vazia — leitor de tela só anuncia o que entra numa região que já estava
 * lá.
 */

/**
 * O DESENHO DIZ DE QUE NATUREZA É O AVISO, antes de a frase ser lida — e agora
 * em cada linha, não só na primeira.
 *
 * O ícone vem antes da cor: as quatro naturezas pedem a mesma coisa (você), e
 * por isso compartilham o âmbar. O que muda entre elas é o motivo, e é o ícone
 * que o diz — o calendário do dia que passou, as pessoas da equipe, o jornal do
 * Diário e o martelo do tribunal.
 *
 * O `??` na leitura é a rede da janela de troca: tipo que a tela não conhece já
 * não chega aqui (`soConhecidas`), mas um ícone faltando não pode derrubar o
 * cabeçalho de todas as páginas.
 */
const ICONE: Record<TipoPendencia, typeof AlertTriangle> = {
  ATRASADA: CalendarClock,
  PRECISA_DA_EQUIPE: Users,
  PUBLICACAO_SEM_TAREFA: Newspaper,
  ATO_ESPERANDO_OLHO: Gavel,
};

export function FaixaDeAtraso() {
  const { user } = useAuth();
  const permitido = podeVer(user?.role, user?.permissoes, 'agenda');

  const { data } = useQuery({
    queryKey: ['minhas-pendencias'],
    queryFn: minhasPendencias,
    enabled: permitido,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const avisos = avisosDaFaixa(data?.pendencias ?? []);

  /*
    A REGIÃO FICA NO DOM MESMO SEM AVISO — é o que faz o aviso novo ser falado.
    Um `return null` monta a região junto com o texto, e leitor de tela nenhum
    anuncia uma região que acabou de nascer. Vazia ela é `sr-only`: não ocupa
    espaço, não desenha borda, não muda nada na tela.
  */
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        avisos.length
          ? 'border-b border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40'
          : 'sr-only'
      }
    >
      {avisos.length > 0 && (
        <ul className="flex flex-col px-2 py-1 md:px-4">
          {avisos.map((a) => {
            const Icone = ICONE[a.tipo] ?? AlertTriangle;
            return (
              <li key={a.chave} className="min-w-0">
                <Link
                  href={a.href}
                  className="group flex min-h-[2.25rem] items-center gap-2.5 rounded-md px-2 py-1 text-sm text-amber-900 transition-colors hover:bg-amber-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/60 dark:text-amber-100 dark:hover:bg-amber-900/40"
                >
                  <Icone
                    className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
                    aria-hidden
                  />
                  {/*
                    NO CELULAR A FRASE QUEBRA; NO COMPUTADOR ELA CORTA.

                    A 400px cabem ~47 letras numa linha, e até uma contagem curta
                    passa disso ("2 atividades da sua equipe estão sem ninguém
                    cuidando" tem 52). Cortar ali seria o defeito antigo de novo,
                    e pior: no celular não existe passar o mouse, então o `title`
                    que devolve a frase inteira não devolve nada. Por isso o
                    texto ocupa até duas linhas no telefone (`line-clamp-2`) e
                    volta a uma linha com reticências quando a tela é larga
                    (`sm:line-clamp-1`), onde o `title` funciona.

                    O contorno desce para a própria linha no telefone, em vez de
                    roubar metade da frase principal: "«Juntar documentos» está
                    sem ninguém cuidando · de Dr. Tiago · ficou para trás" tem 78
                    letras, e é o "de Dr. Tiago" que sumiria — justamente de quem
                    é a tarefa.

                    Medido no Chrome com o desenho real, em 400/768/1280/1366/
                    1440px: nada transborda e todo corte deixa reticências.

                    O `title` FICA AQUI, E NÃO NO LINK. No link ele vira a
                    DESCRIÇÃO acessível, e o leitor de tela leria a mesma frase
                    duas vezes — o nome, vindo do texto, e a descrição, vindo do
                    title. Num aviso que aparece em toda tela, isso é ruído. Num
                    <span> ele é só o balãozinho do mouse, que é para o que
                    serve: devolver o que as reticências comeram.
                  */}
                  <span
                    title={frasePlena(a)}
                    className="flex min-w-0 flex-col gap-x-1.5 sm:flex-row sm:flex-wrap sm:items-baseline"
                  >
                    <span className="min-w-0 font-medium line-clamp-2 underline-offset-4 group-hover:underline sm:line-clamp-1">
                      {a.texto}
                    </span>
                    {a.complemento && (
                      <>
                        <span
                          aria-hidden
                          className="hidden text-amber-700/60 dark:text-amber-300/50 sm:inline"
                        >
                          ·
                        </span>
                        <span className="min-w-0 text-xs text-amber-800/90 line-clamp-2 dark:text-amber-200/80 sm:text-sm sm:line-clamp-1">
                          {a.complemento}
                        </span>
                      </>
                    )}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-amber-700/50 transition-colors group-hover:text-amber-800 dark:text-amber-300/40 dark:group-hover:text-amber-200"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
