'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Inbox, Check, X, ChevronDown, Clock, Loader2, RefreshCw,
  Hourglass, History, ExternalLink, UserX,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import {
  listarPropostas, aceitarProposta, recusarProposta,
  quantasMostrar, rodapeDaCaixa, seloDaProposta,
  PROVIDENCIA_LABEL, PROVIDENCIA_COR, PROVIDENCIA_COR_PADRAO,
  MOTIVOS_DE_RECUSA, type PropostaDeTarefa,
} from '@/lib/djen';
import { formatNPU } from '@/lib/processos';
import { separarTimbre } from '@/lib/timbre-do-tribunal';

/**
 * A CAIXA DE ENTRADA DO ADVOGADO — o robô propõe, a pessoa decide.
 *
 * POR QUE ESTA TELA EXISTE
 * O robô lê o teor da publicação e tenta descobrir de quem é a ordem. Medido
 * nas 1.433 do acervo: PROVA que é nossa em 15,8%, prova que é da outra parte
 * em 4,1% — e nos 80% restantes não sabe. Criar tarefa nesses 80% foi o que
 * encheu a agenda de trabalho alheio (das 14 que ele criou, 5 já tinham sido
 * canceladas à mão); não criar perderia prazo.
 *
 * A pergunta estava errada. Quem decide se aquilo é trabalho dele é o advogado,
 * e ele decide em um segundo — desde que veja O TRECHO DA ORDEM, que é onde
 * está o "de quem é isto". Por isso a prévia não é o título da providência nem
 * o teor inteiro: é a frase em que o juízo manda alguém fazer algo.
 *
 * O QUE NÃO CHEGA AQUI
 * Ordem nossa provada COM prazo escrito vira tarefa direto. Pedir aprovação
 * para um prazo já demonstrado é cerimônia, e cerimônia faz gente parar de ler.
 *
 * "ELAS SOMEM DEPOIS QUE PERDEM O PRAZO?" — a pergunta do dono, 18/09/2026.
 *
 * Não somem, e não vão sumir: não há corte de data nesta caixa, e esconder
 * prazo é o pior defeito possível aqui. O problema era o contrário — a proposta
 * do dia 60 era desenhada IGUAL à do dia 1, e a caixa parecia um depósito.
 *
 * Medido na produção no mesmo dia: 16 propostas na casa inteira, a mais velha
 * com 9 dias, e 15 das 16 SEM prazo escrito no ato — ou seja, sem a rede que
 * transforma proposta esquecida em tarefa. Quinze itens que ficariam ali para
 * sempre se ninguém olhasse, todos com a mesma cara.
 *
 * O que mudou, e nada disso é enfeite:
 *
 *  1. IDADE VIROU ESTADO (servidor, `situacaoDaProposta`). Passado o prazo em
 *     que o robô desiste de esperar, o item fica ÂMBAR e diz há quantos dias
 *     está parado. Ato fora da janela de trabalho ganha selo próprio: o robô
 *     não age mais, e essa desistência era silenciosa.
 *  2. O QUE PEDE ALGUÉM SOBE, e o corte cede para ele — nunca o contrário.
 *  3. O ITEM TEM DESTINO. O comentário antigo prometia que "o resto está a um
 *     toque"; não havia um único link. Agora a linha das partes abre o
 *     processo e o ato inteiro abre no tribunal.
 *  4. O DONO APARECE para quem coordena — é a caixa em que entram as ÓRFÃS, e
 *     "sem dono" era invisível justamente na tela feita para vê-las.
 *
 * MOBILE-FIRST: no celular cada proposta é um cartão empilhado com os dois
 * botões lado a lado ocupando a largura toda — alvos de 44px, sem menu, sem
 * navegação. No desktop a mesma coisa em linha, com o trecho da ordem à
 * esquerda e os botões à direita.
 */
export function CaixaDePropostas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  /*
    QUEM DECIDE PRECISA PODER EDITAR. A rota é `@Modulo('processos')` e aceitar
    CRIA atividade — desenhar os botões para quem levaria 403 é oferecer um
    caminho que não existe.
  */
  const permitido = podeEditar(user?.role, user?.permissoes, 'processos');
  /*
    QUEM COORDENA VÊ AS ÓRFÃS — e sem isto não via NADA.

    O painel pedia sempre a caixa pessoal. Como administrador e coordenação não
    têm OAB, nenhuma proposta é endereçada a eles: os três admins e a
    coordenação abriam o painel e a caixa simplesmente não existia — inclusive
    para a proposta ÓRFÃ, que foi a razão de o parâmetro `todas` ter sido
    escrito. Um prazo sem dono corria sem ninguém para vê-lo.

    O escopo ampliado é "minhas OU sem dono", nunca a caixa da equipe inteira:
    despejar 40 propostas/mês no coordenador é entregar uma caixa que ninguém
    abre, e ainda o faz decidir sobre processo que não acompanha.
  */
  const ehGestao = user?.role === 'ADMINISTRADOR' || user?.role === 'COORDENACAO';
  const [aberta, setAberta] = useState<string | null>(null);
  /*
    "VER AS OUTRAS" ABRE AQUI MESMO. O link ia para `/publicacoes?caixa=1`, e a
    tela de publicações não lê `caixa`: caía no acervo inteiro, com outro número.
    A caixa já tem todas as propostas em mãos — mostrar o resto no lugar é o
    único destino que conta o mesmo que o rodapé.
  */
  const [todas, setTodas] = useState(false);

  const q = useQuery({
    queryKey: ['djen', 'propostas', ehGestao ? 'com-orfas' : 'minhas'],
    queryFn: () => listarPropostas(ehGestao),
    enabled: permitido,
    staleTime: 30_000,
    retry: false,
  });

  const invalidar = () => {
    // Prefixo: alcança tanto 'minhas' quanto 'com-orfas'. E as chaves que
    // existem: ['agenda'] e ['dashboard'] não eram de consulta nenhuma.
    qc.invalidateQueries({ queryKey: ['djen', 'propostas'] });
    qc.invalidateQueries({ queryKey: ['compromissos'] });
    qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
    qc.invalidateQueries({ queryKey: ['minhas-pendencias'] });
  };

  const aceitar = useMutation({
    mutationFn: (id: string) => aceitarProposta(id),
    onSuccess: () => {
      toast.success('Virou atividade na sua agenda.');
      invalidar();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível aceitar agora.'),
  });

  const recusar = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => recusarProposta(id, motivo),
    onSuccess: () => {
      toast.success('Dispensada. O motivo ajuda o robô a errar menos.');
      setAberta(null);
      invalidar();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível dispensar agora.'),
  });

  if (!permitido) return null;

  /*
    FALHA NÃO É CAIXA VAZIA. Com `retry: false`, um erro de rede fazia o cartão
    sumir como se não houvesse nada a decidir — e o que some aqui é prazo.
  */
  if (q.isError) {
    return (
      <Card className="flex flex-col gap-2 border-amber-300 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60">
        <span className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
          <Inbox className="mt-0.5 h-4 w-4 shrink-0" />
          Não foi possível carregar as publicações que esperam decisão.
        </span>
        <button
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 self-start rounded-md border border-input px-3 text-xs font-medium transition hover:bg-muted disabled:opacity-60 sm:h-8 sm:self-auto"
        >
          {q.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Tentar de novo
        </button>
      </Card>
    );
  }

  const itens = q.data ?? [];
  if (!itens.length) return null;

  /*
    O CORTE CEDE PARA O QUE PEDE ALGUÉM — ver `quantasMostrar`. A fila já chega
    ordenada pelo servidor, com o parado na frente; aqui só se garante que
    nenhum parado fique atrás do "ver as outras".
  */
  const visiveis = quantasMostrar(itens);
  const mostradas = todas ? itens : itens.slice(0, visiveis);
  const rodape = rodapeDaCaixa(itens.slice(visiveis));
  const paradas = itens.filter((i) => i.estado !== 'NOVA').length;

  return (
    <Card className="overflow-hidden border-sky-200 dark:border-sky-900/50">
      <div className="flex items-start gap-3 border-b border-sky-100 bg-sky-50/60 px-4 py-3 dark:border-sky-900/40 dark:bg-sky-950/20">
        <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {itens.length === 1
              ? '1 publicação esperando sua decisão'
              : `${itens.length} publicações esperando sua decisão`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ehGestao
              ? /*
                  NA GESTÃO ENTRAM AS ÓRFÃS, e "É minha" punha a tarefa na agenda
                  do administrador — que não tem OAB e não executa prazo. O
                  botão diz o que faz, e esta linha diz para quem vai.
                */
                'Entram aqui as suas e as que não têm dono. "Ficar com ela" põe a tarefa na SUA agenda; se o prazo é de outro advogado, avise quem responde pelo caso.'
              : 'O robô não teve certeza de que o prazo é seu. Confira a ordem do juízo e decida — nada entra na sua agenda sem você.'}
          </p>
          {/*
            A RESPOSTA DA PERGUNTA, escrita onde ela é feita.

            Publicação não expira nem é arquivada por tempo: sem decisão, ela
            fica. Dizer isso uma vez no cabeçalho evita a dúvida que levou a
            esta revisão — e, quando há item parado, o número vem junto, porque
            aí a frase deixa de ser tranquilizadora e passa a ser um pedido.
          */}
          <p className={cn(
            'mt-1 text-xs',
            paradas ? 'font-medium text-amber-900 dark:text-amber-300' : 'text-muted-foreground',
          )}>
            {paradas
              ? `${paradas === 1 ? '1 está parada' : `${paradas} estão paradas`} esperando uma pessoa — e nenhuma some com o tempo.`
              : 'Nada some daqui por tempo.'}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-sky-100 dark:divide-sky-900/30">
        {mostradas.map((p) => (
          <LinhaDaProposta
            key={p.id}
            proposta={p}
            ehGestao={ehGestao}
            /* Ocupado por LINHA: decidir uma não trava as outras. */
            ocupado={
              (aceitar.isPending && aceitar.variables === p.id) ||
              (recusar.isPending && recusar.variables?.id === p.id)
            }
            recusando={aberta === p.id}
            onAbrirRecusa={() => setAberta(aberta === p.id ? null : p.id)}
            onAceitar={() => aceitar.mutate(p.id)}
            onRecusar={(motivo) => recusar.mutate({ id: p.id, motivo })}
          />
        ))}
      </ul>

      {rodape && (
        <button
          type="button"
          onClick={() => setTodas((v) => !v)}
          aria-expanded={todas}
          className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-sky-100 px-4 py-2.5 text-left text-xs font-medium text-brand-800 transition hover:bg-muted/60 dark:border-sky-900/30 dark:text-brand-300"
        >
          {todas ? 'Mostrar só as primeiras' : rodape}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', todas && 'rotate-180')} />
        </button>
      )}
    </Card>
  );
}

/**
 * O SELO DA IDADE — âmbar, porque âmbar é a cor de "pede você".
 *
 * Vermelho não entra: vermelho é do Excluir, e o sistema não afirma que o prazo
 * venceu — ele só sabe há quantos dias ninguém decidiu. E os dois selos têm
 * ÍCONES diferentes antes da cor: "parada" e "ato antigo" pedem coisas
 * diferentes (uma decisão versus uma decisão que já nasce atrasada), e dois
 * significados nunca dividem o mesmo desenho.
 */
function SeloDaIdade({ estado, rotulo }: { estado: PropostaDeTarefa['estado']; rotulo: string }) {
  const Icone = estado === 'FORA_DA_JANELA' ? History : Hourglass;
  return (
    <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      <Icone className="h-3 w-3" />
      {rotulo}
    </span>
  );
}

function LinhaDaProposta({
  proposta: p,
  ehGestao,
  ocupado,
  recusando,
  onAbrirRecusa,
  onAceitar,
  onRecusar,
}: {
  proposta: PropostaDeTarefa;
  /** Na gestão o aceite põe a tarefa em quem clica — e o botão tem de dizer isso. */
  ehGestao: boolean;
  ocupado: boolean;
  recusando: boolean;
  onAbrirRecusa: () => void;
  onAceitar: () => void;
  onRecusar: (motivo: string) => void;
}) {
  const [livre, setLivre] = useState('');
  const selo = seloDaProposta(p);
  /*
    OS DIAS VÊM DO SERVIDOR, e não de uma conta aqui.

    `dataDisponibilizacao` é `@db.Date`: chega como meia-noite UTC, e subtrair
    um instante disso erra por até um dia inteiro. A conta certa já existia dos
    dois lados — e duas contas são duas verdades. Hoje o número que a tela
    mostra é exatamente o que define o ESTADO da proposta.
  */
  const dias = p.diasDoAto;
  const npu = (formatNPU(p.numeroProcesso) || p.numeroProcesso).slice(0, 11);

  return (
    <li className={cn('px-4 py-3', selo.pedeVoce && 'bg-amber-50/40 dark:bg-amber-950/10')}>
      <div className="flex flex-wrap items-center gap-1.5">
        {p.providencia && PROVIDENCIA_LABEL[p.providencia] && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              PROVIDENCIA_COR[p.providencia] ?? PROVIDENCIA_COR_PADRAO,
            )}
          >
            {PROVIDENCIA_LABEL[p.providencia]}
          </span>
        )}
        {/*
          O PRAZO É O QUE MUDA A URGÊNCIA DA DECISÃO — e por isso vem em âmbar,
          não em vermelho: o sistema não calcula vencimento, só repete o que o
          tribunal escreveu.
        */}
        {p.prazoMencionadoDias != null && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            menciona {p.prazoMencionadoDias} dias
          </span>
        )}
        {selo.rotulo && <SeloDaIdade estado={p.estado} rotulo={selo.rotulo} />}
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {dias === 0 ? 'hoje' : `há ${dias}d`}
        </span>
        {/*
          O DONO SÓ APARECE PARA QUEM COORDENA.

          Na caixa do advogado toda proposta é dele — desenhar o próprio rosto
          em cada linha é gastar espaço para não dizer nada. Na da gestão entram
          as ÓRFÃS, e "sem dono" é a informação que faz a tela existir: um prazo
          sem responsável corre igual.
        */}
        {ehGestao && (
          <span className="ml-auto flex items-center gap-1 text-[11px]">
            {p.propostaPara ? (
              <>
                <AvatarPessoa
                  nome={p.propostaPara.nomeExibicao || p.propostaPara.nome}
                  url={p.propostaPara.avatarUrl}
                  tamanho="xs"
                />
                <span className="max-w-[9rem] truncate text-muted-foreground">
                  {p.propostaPara.nomeExibicao || p.propostaPara.nome}
                </span>
              </>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <UserX className="h-3 w-3" /> sem dono
              </span>
            )}
          </span>
        )}
      </div>

      {/*
        UMA LINHA, NÃO DUAS — e agora ela LEVA A ALGUM LUGAR.

        Medido no telefone: cada proposta custava 192px, e quatro delas somavam
        898px — mais que a dobra inteira (600px). O NPU divide a linha com o
        adversário, que é quem a pessoa lê primeiro; o número trunca antes do
        nome porque vinte dígitos não decidem nada.

        O ADVERSÁRIO VEM PRONTO DO SERVIDOR. Aqui se fazia
        `partes.find(polo === 'PASSIVO')` — uma segunda implementação da regra
        do painel, e a errada: quando a ação é contra o sindicato, o passivo
        somos nós, e a linha imprimia o nome do próprio sindicato como
        adversário.
      */}
      {(() => {
        const linha = (
          <>
            <span className="min-w-0 flex-1 truncate">
              {p.adversario ? (
                <>
                  <span className="text-muted-foreground">× </span>
                  {p.adversario}
                </>
              ) : (
                <span className="text-muted-foreground">{p.nomeClasse ?? 'Publicação'}</span>
              )}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{npu}…</span>
          </>
        );
        return p.processo?.id ? (
          <Link
            href={`/processos?processo=${p.processo.id}`}
            className="mt-1 flex min-w-0 items-baseline gap-1.5 text-sm underline-offset-2 hover:underline"
          >
            {linha}
          </Link>
        ) : (
          <p className="mt-1 flex min-w-0 items-baseline gap-1.5 text-sm">{linha}</p>
        );
      })()}

      {/*
        A PRÉVIA QUE FAZ A DECISÃO DURAR UM SEGUNDO.

        Não é o título da providência (pede fé) nem o teor inteiro, que tem
        2.476 caracteres em média (pede leitura). É a frase em que o juízo manda
        alguém fazer algo — é ali que está o "de quem é isto".

        Sem ordem legível cai para o começo do teor: 29,9% dos atos não têm
        ordem nenhuma escrita, e inventar uma seria pior que mostrar o texto. É
        só nesse caso que a API manda texto — ver `PropostaDeTarefa.texto`.

        DUAS LINHAS, NÃO TRÊS: 180 caracteres a 319px de largura ocupam três, e
        `line-clamp-2` corta em duas. A frase da ordem começa pelo verbo, então
        as duas primeiras já dizem de quem é; o resto está no ato do tribunal,
        no link logo abaixo.
      */}
      <p className="mt-1.5 line-clamp-2 rounded-md bg-muted/60 px-2 py-1.5 text-[11px] leading-snug">
        {p.ordem ?? previaSemTimbre(p.texto)}
      </p>

      {/*
        O RECADO DA IDADE — o que acontece se ninguém decidir.

        É ESTADO, não evento: nasce da data, não tem o que fechar e volta a
        aparecer amanhã se o item continuar aqui. E não promete o que o robô vai
        fazer — a rede dele tem uma condição que só o teor responde, e anunciar
        uma tarefa que ele pode recusar é o alarme que contradiz o robô.
      */}
      {selo.recado && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-amber-900 dark:text-amber-300">
          {p.estado === 'FORA_DA_JANELA' ? (
            <History className="mt-0.5 h-3 w-3 shrink-0" />
          ) : (
            <Hourglass className="mt-0.5 h-3 w-3 shrink-0" />
          )}
          {selo.recado}
        </p>
      )}

      {!recusando ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onAceitar}
            disabled={ocupado}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-800 px-3 text-sm font-medium text-white transition hover:bg-brand-900 disabled:opacity-60 sm:h-9"
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {ehGestao ? 'Ficar com ela' : 'É minha'}
          </button>
          <button
            type="button"
            onClick={onAbrirRecusa}
            disabled={ocupado}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium transition hover:bg-muted disabled:opacity-60 sm:h-9"
          >
            <X className="h-4 w-4" />
            {ehGestao ? 'Dispensar' : 'Não é minha'}
          </button>
        </div>
      ) : (
        /*
          O MOTIVO É O ÚNICO DADO QUE DIZ ONDE A REGRA ERRA.

          Hoje o robô só sabe que 80% dos atos são indefinidos. Com o motivo ele
          passa a saber quantos eram da outra parte, quantos já estavam
          resolvidos e quantos não pedem nada — é por aí que a heurística
          melhora sem palpite.

          Botões prontos em vez de campo livre: num celular, texto livre é o
          jeito mais rápido de o motivo vir vazio. O campo livre fica embaixo,
          para o que não couber nos três.
        */
        <div className="mt-2 space-y-2 rounded-md border border-input p-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {ehGestao ? 'Por que dispensar?' : 'Por que não é sua?'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_DE_RECUSA.map((m) => (
              <button
                key={m.slug}
                type="button"
                onClick={() => onRecusar(m.label)}
                disabled={ocupado}
                className="h-11 rounded-md border border-input px-2.5 text-xs font-medium transition hover:bg-muted disabled:opacity-60 sm:h-9"
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={livre}
              onChange={(e) => setLivre(e.target.value)}
              placeholder="Outro motivo…"
              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-base sm:h-9 sm:text-xs"
            />
            <button
              type="button"
              onClick={() => onRecusar(livre.trim() || 'Não informado')}
              disabled={ocupado}
              className="h-11 shrink-0 rounded-md bg-muted px-3 text-xs font-medium transition hover:bg-muted/70 disabled:opacity-60 sm:h-9"
            >
              Dispensar
            </button>
            <button
              type="button"
              onClick={onAbrirRecusa}
              aria-label="Fechar os motivos"
              className="h-11 w-11 shrink-0 rounded-md px-2 text-xs text-muted-foreground transition hover:bg-muted sm:h-9 sm:w-9"
            >
              <ChevronDown className="mx-auto h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/*
        O ATO INTEIRO, A UM TOQUE — e este toque não existia.

        O comentário que ficava aqui dizia que "o resto está a um toque, na
        publicação". Não havia link nenhum no item: quem quisesse ler o
        despacho tinha de sair do painel, abrir Publicações e procurar. Duas
        linhas de prévia são o bastante para decidir na maioria dos casos, mas
        quando não são, o documento do tribunal é o destino certo — é o texto
        oficial, e é ele que tira a dúvida.
      */}
      {p.link && !recusando && (
        <a
          href={p.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex min-h-11 items-center gap-1 text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline sm:min-h-0 dark:text-brand-300"
        >
          <ExternalLink className="h-3 w-3" /> Ler o ato no tribunal
        </a>
      )}
    </li>
  );
}

/**
 * O FALLBACK NUNCA MOSTRA O TIMBRE.
 *
 * Quando o ato não tem ordem legível (29,9% deles), a prévia é o começo do
 * teor — e o teor começa, em 83% dos casos, com 302 caracteres de "PODER
 * JUDICIÁRIO JUSTIÇA DO TRABALHO TRIBUNAL REGIONAL…". Mostrar isso é o mesmo
 * que não mostrar nada, e foi o que a simulação contra a produção revelou.
 *
 * `separarTimbre` é a mesma função que o cartão de publicação usa e que já tem
 * teste — não existe segunda cópia da régua do timbre.
 *
 * NULO ENTRA E NÃO DERRUBA A TELA. A API só manda texto quando não conseguiu
 * recortar a ordem, e o `(corpo || texto)` antigo estourava num `texto`
 * ausente: `separarTimbre` devolve corpo vazio, o `||` caía no argumento, e o
 * `.replace` de um nulo derruba o painel inteiro.
 */
function previaSemTimbre(texto: string | null): string {
  if (!texto) return 'Sem prévia — abra o ato no tribunal.';
  const { corpo } = separarTimbre(texto);
  const limpo = (corpo || texto).replace(/\s+/g, ' ').trim();
  return limpo.length > 180 ? `${limpo.slice(0, 180)}…` : limpo;
}
