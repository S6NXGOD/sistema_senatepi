import { api } from './api';
import { contar } from './plural';
import { mascararNPU } from './processos';

/**
 * O QUE NÃO PODE ESPERAR — o que alimenta a faixa em cima de toda tela.
 *
 * ESTADO, e não evento: o que é verdade neste instante. Concluiu a tarefa, o
 * aviso some — sem clicar em nada, sem "marcar como lida", sem histórico.
 *
 * Até 12/09/2026 isto alimentava também um sino no topo, com sete grupos. O sino
 * saiu: repetia o painel numa gaveta que ninguém abria. Ficaram os grupos
 * que justificam interromper qualquer tela.
 */

export type TipoPendencia =
  | 'ATRASADA'
  | 'PRECISA_DA_EQUIPE'
  | 'PUBLICACAO_SEM_TAREFA'
  | 'ATO_ESPERANDO_OLHO';

export interface Pendencia {
  tipo: TipoPendencia;
  total: number;
  exemplos: {
    id: string;
    titulo: string;
    quando: string | null;
    href: string;
    /** O porquê, quando o item é da equipe: "Dr. Carlos está sem entrar há 39 dias". */
    detalhe?: string;
  }[];
}

export interface MinhasPendencias {
  pendencias: Pendencia[];
  total: number;
}

/**
 * TIPO QUE A TELA NÃO CONHECE NÃO ENTRA — defesa da janela de troca.
 *
 * A faixa lê `PENDENCIA[p.tipo]` sem rede: um tipo novo vindo de uma API mais
 * nova que a tela quebraria o cabeçalho de TODAS as páginas por alguns minutos.
 * Filtrar aqui, na porta, protege todo mundo que consome a lista — inclusive o
 * próximo tipo, e os grupos antigos que uma API de antes ainda mande.
 */
export function soConhecidas(pendencias: Pendencia[]): Pendencia[] {
  return pendencias.filter((p) => Object.prototype.hasOwnProperty.call(PENDENCIA, p.tipo));
}

export async function minhasPendencias(): Promise<MinhasPendencias> {
  const { data } = await api.get<MinhasPendencias>('/minhas-pendencias');
  return { ...data, pendencias: soConhecidas(data.pendencias ?? []) };
}

/**
 * O rótulo de cada grupo, no singular e no plural, e para onde a contagem leva.
 *
 * "PRAZO VENCIDO" NÃO ENTRA: o sistema conhece a data que alguém marcou na
 * agenda, não o prazo processual. Afirmar perda de prazo é a acusação mais grave
 * que ele poderia fazer a um advogado, e ele não tem como sustentá-la. "Ficou
 * para trás" é exatamente o que o dado diz.
 *
 * O SINGULAR NÃO É ENFEITE. Quando há um item só, a faixa diz QUAL é ele (ver
 * `avisoDaFaixa`) e estas frases não aparecem. Elas são a queda da janela de
 * troca: uma API mais antiga — ou um grupo que voltou com `total` e sem
 * `exemplos` — ainda precisa virar uma frase certa em português. Era código
 * morto enquanto só dois tipos tinham nome; hoje os quatro têm, e os quatro
 * singulares existem por essa razão só. `avisos-da-faixa.spec.ts` cobra cada um.
 */
export const PENDENCIA: Record<TipoPendencia, { um: string; varios: string; href: string }> = {
  ATRASADA: {
    um: 'atividade sua ficou para trás',
    varios: 'atividades suas ficaram para trás',
    href: '/agenda',
  },
  /*
    A TAREFA DO CASO EM QUE VOCÊ É RESERVA, E NINGUÉM ESTÁ CUIDANDO — o
    responsável sumiu, ou o dia virou. Várias levam ao painel, onde o bloco
    "Da sua equipe" diz de quem é cada uma e por quê; uma só leva direto à
    atividade, onde está o botão "Assumir".
  */
  PRECISA_DA_EQUIPE: {
    um: 'atividade da sua equipe está sem ninguém cuidando',
    varios: 'atividades da sua equipe estão sem ninguém cuidando',
    href: '/dashboard',
  },
  PUBLICACAO_SEM_TAREFA: {
    um: 'publicação sua sem tarefa aberta',
    varios: 'publicações suas sem tarefa aberta',
    href: '/publicacoes',
  },
  /*
    O ATO QUE O ROBÔ NÃO SOUBE RESOLVER — o alerta que entrou no lugar da tarefa
    cega, em 17/09/2026.

    "Se for algo urgente, mande um alerta, mas não encha de tarefas
    desnecessárias." O robô do DataJud abria "Verificação de Intimação / Prazo"
    sem saber o que o juízo pediu; 32 das 48 foram canceladas. Agora o ato
    aparece aqui, como ESTADO, e some quando alguém decide — virando tarefa ou
    marcando "já cuidei" na ficha.

    "SEM NINGUÉM DECIDIR", e não "sem providência": o sistema não sabe se há
    providência a tomar. Ele sabe que o tribunal praticou um ato dos que costumam
    pedir uma, e que ninguém olhou. Prometer mais que isso é o que fez a tarefa
    cega perder a confiança de quem a recebia.
  */
  ATO_ESPERANDO_OLHO: {
    um: 'ato do tribunal está sem ninguém decidir',
    varios: 'atos do tribunal estão sem ninguém decidir',
    href: '/processos',
  },
};

export function rotulo(p: Pendencia): string {
  const r = PENDENCIA[p.tipo];
  return contar(p.total, r.um, r.varios);
}

/**
 * UM AVISO DA FAIXA — em duas partes, porque a faixa desenha as duas.
 *
 * `texto` é a coisa (o que aconteceu, com o nome dela). `complemento` é o
 * contorno: de quem é, em que processo. A separação existe porque colar os dois
 * numa frase só produzia português torto — o detalhe da equipe já vem escrito
 * como legenda pela API ("de Dr. Tiago · ficou para trás"), e emendá-lo com um
 * travessão dava "«Elaborar manifestação» precisa de alguém da equipe — de
 * Dr. Tiago · ficou para trás". Duas partes, e cada uma lida como foi escrita.
 */
export interface AvisoDaFaixa {
  chave: string;
  tipo: TipoPendencia;
  texto: string;
  complemento?: string;
  href: string;
}

/**
 * LINK COM PARÂMETRO VAZIO NÃO É DESTINO.
 *
 * A API monta o endereço do exemplo com o id que ela tem: `/processos?processo=`
 * quando a publicação chegou sem processo casado. O endereço existe, a página
 * abre — e não abre nada, o que é pior que não ser clicável, porque a pessoa
 * acha que já olhou. Nesse caso o aviso cai na lista do grupo, que ao menos é
 * um lugar onde se procura.
 */
const PARAMETRO_VAZIO = /[?&][^=&]+=(?:&|$)/;

export function destinoCerto(href: string | undefined, lista: string): string {
  if (!href) return lista;
  return PARAMETRO_VAZIO.test(href) ? lista : href;
}

/**
 * ONDE O ATO ACONTECEU — e nunca uma frase que termina no nada.
 *
 * O título do exemplo é o número do processo, cru (20 dígitos), e a API usa
 * 'Processo'/'Publicação' quando não há número: o caso ainda é pré-processual
 * ou rascunho, e `numeroCNJ` é nulo de propósito. `mascararNPU` de um texto sem
 * dígitos devolve vazio, e era assim que nascia "Recurso negado no processo "
 * — frase truncada, no cabeçalho de todas as telas.
 */
export function ondeAconteceu(titulo: string): string {
  const npu = mascararNPU(titulo || '');
  return npu ? `processo ${npu}` : 'processo ainda sem número';
}

/**
 * A FRASE DA FAIXA — uma por grupo, e para onde ela leva.
 *
 * Um item só vira frase com o NOME da coisa e leva ao próprio item: "1 atividade
 * ficou para trás" obrigaria a abrir a agenda para descobrir qual. Vários viram
 * contagem e levam à lista. É a regra de todo aviso deste sistema: leva ao ato,
 * não à tela onde o ato mora.
 *
 * OS QUATRO TIPOS TÊM NOME PRÓPRIO. Faltavam dois: a publicação sem tarefa
 * mostrava "1 publicação sua sem tarefa aberta" — número sem destino, que é
 * exatamente o que esta regra existe para não fazer.
 */
export function avisoDaFaixa(p: Pendencia): AvisoDaFaixa {
  const grupo = PENDENCIA[p.tipo];
  const unico = p.total === 1 ? p.exemplos?.[0] : undefined;
  const chave = p.tipo;

  if (unico) {
    const href = destinoCerto(unico.href, grupo.href);
    if (p.tipo === 'ATRASADA') {
      return { chave, tipo: p.tipo, texto: `“${unico.titulo}” ficou para trás`, href };
    }
    /*
      O PORQUÊ VAI NO COMPLEMENTO, INTEIRO E COMO A API O ESCREVEU. Ele já é uma
      legenda ("de Dr. Tiago · ficou para trás", "Dr. Carlos está sem entrar há
      39 dias") e o mesmo texto aparece no painel, no bloco da equipe.
    */
    if (p.tipo === 'PRECISA_DA_EQUIPE') {
      return {
        chave,
        tipo: p.tipo,
        texto: `“${unico.titulo}” está sem ninguém cuidando`,
        complemento: unico.detalhe,
        href,
      };
    }
    /*
      UMA PUBLICAÇÃO SÓ DIZ EM QUE PROCESSO ELA CAIU. O título do exemplo é o
      número do processo; a providência não vem, e inventar qual é seria
      prometer o que não sabemos.
    */
    if (p.tipo === 'PUBLICACAO_SEM_TAREFA') {
      return {
        chave,
        tipo: p.tipo,
        texto: 'Publicação sua sem tarefa aberta',
        complemento: ondeAconteceu(unico.titulo),
        href,
      };
    }
    /*
      UM ATO SÓ DIZ QUAL ATO E EM QUE PROCESSO. "1 ato do tribunal está sem
      ninguém decidir" manda procurar entre dezenas de linhas da ficha;
      "Recurso negado · processo 0001381-91…" já é a informação.
    */
    if (p.tipo === 'ATO_ESPERANDO_OLHO' && unico.detalhe) {
      return {
        chave,
        tipo: p.tipo,
        texto: unico.detalhe,
        complemento: ondeAconteceu(unico.titulo),
        href,
      };
    }
    return { chave, tipo: p.tipo, texto: rotulo(p), href };
  }

  return { chave, tipo: p.tipo, texto: rotulo(p), href: grupo.href };
}

/**
 * OS AVISOS DA FAIXA, NA ORDEM EM QUE SE RESOLVE — e só os que a tela desenha.
 *
 * `soConhecidas` já roda na porta da API; roda de novo aqui porque esta lista
 * também é montada a partir de cache antigo do react-query, e um `PENDENCIA[tipo]`
 * indefinido derrubaria o cabeçalho de todas as páginas.
 */
export function avisosDaFaixa(pendencias: Pendencia[]): AvisoDaFaixa[] {
  return soConhecidas(pendencias ?? [])
    .filter((p) => p.total > 0)
    .map(avisoDaFaixa);
}

/**
 * O aviso inteiro numa linha — para o `title` do link e para quem lê a tela em
 * voz alta. A faixa corta o texto com reticências quando não cabe; o que foi
 * cortado tem de continuar alcançável sem abrir a página.
 */
export function frasePlena(a: AvisoDaFaixa): string {
  return a.complemento ? `${a.texto} — ${a.complemento}` : a.texto;
}

/**
 * A FAIXA CALA O QUE A TELA JÁ DIZ — 18/09/2026.
 *
 * "A barra amarela continua ali, muito feia e pra mim não chama atenção e nem
 * vai fazer o advogado realizar nenhuma ação."
 *
 * Ela não chamava atenção porque estava REPETINDO. Medido em duas telas, com o
 * navegador aberto:
 *
 *  · no PAINEL, o aviso dizia «Elaborar manifestação» ficou para trás e, dois
 *    dedos abaixo, a mesma atividade aparecia na fila com selo ATRASADA e um
 *    botão que resolve;
 *  · na AGENDA, "ficaram para trás" aparecia TRÊS vezes na mesma dobra: a
 *    faixa no topo, a aba "Ficaram para trás 5" e um segundo aviso âmbar dentro
 *    da lista, com "Ver só essas" — este último filtrando de verdade.
 *
 * Aviso que repete o que está logo abaixo, e que faz menos que o que está logo
 * abaixo, ensina a não ler a faixa. E aí ela perde as telas em que é a única voz.
 *
 * A REGRA É POR TELA E POR TIPO, escrita à mão e não deduzida do destino do
 * link: cada linha aqui corresponde a uma superfície que eu abri e conferi.
 * Deduzir de `href` calaria o ato do tribunal em /processos, onde a lista não
 * tem recorte nenhum para ele.
 *
 *  /dashboard   ATRASADA              → a fila "Minhas atividades", com selo,
 *                                       cor e o botão de desfecho na linha
 *               PRECISA_DA_EQUIPE     → o bloco "Da sua equipe", que diz de
 *                                       quem é e por quê
 *               PUBLICACAO_SEM_TAREFA → o bloco "Suas publicações" — que só
 *                                       existe para quem vê processos, por
 *                                       isso esta depende da permissão
 *  /agenda      ATRASADA              → a aba "Ficaram para trás" e o aviso da
 *                                       própria lista, que filtra
 *  /publicacoes PUBLICACAO_SEM_TAREFA → o filtro "Sem tarefa na agenda"
 *
 * O QUE NUNCA SOME: ATO_ESPERANDO_OLHO. O ato do tribunal só existe na ficha
 * do processo, e nenhuma lista o recorta — suprimi-lo seria esconder o único
 * aviso que não tem outro lugar. Foi a objeção que derrubou a primeira versão
 * desta ideia, e ela continua valendo.
 *
 * Em qualquer outra tela, nada é suprimido: lá a faixa é a única voz.
 */
const TELA_JA_DIZ: Record<string, TipoPendencia[]> = {
  '/dashboard': ['ATRASADA', 'PRECISA_DA_EQUIPE', 'PUBLICACAO_SEM_TAREFA'],
  '/agenda': ['ATRASADA'],
  '/publicacoes': ['PUBLICACAO_SEM_TAREFA'],
};

/** Só o primeiro segmento: `/agenda?compromisso=1` e `/agenda/x` são a Agenda. */
export function telaDoCaminho(caminho: string): string {
  return `/${(caminho ?? '').split('?')[0].split('/').filter(Boolean)[0] ?? ''}`;
}

export function avisosNaTela(
  avisos: AvisoDaFaixa[],
  tela: { caminho: string; veProcessos: boolean },
): AvisoDaFaixa[] {
  const calados = TELA_JA_DIZ[telaDoCaminho(tela.caminho)];
  if (!calados) return avisos;
  return avisos.filter((a) => {
    if (!calados.includes(a.tipo)) return true;
    /* O bloco "Suas publicações" do painel não existe sem o módulo de
       processos; sem ele, o painel não diz nada e a faixa continua. */
    if (a.tipo === 'PUBLICACAO_SEM_TAREFA') return !tela.veProcessos;
    return false;
  });
}
