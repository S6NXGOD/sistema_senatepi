import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { dataParaNome, nomeDeArquivo, type DocumentoGerado } from '@core/infra';
import { PrismaService } from '../../prisma/prisma.service';
import { lerLogoDaMarca } from '../../common/assets.util';
import { carimbarRodape } from '../../common/pdf-rodape.util';
import { tenant, rodapeInstitucional } from '../../tenant/tenant.config';
import { PartesService } from './partes.service';
import { NpuUtils } from './utils/npu.util';
import { diaBR, formatarDataBR, formatarDataHoraBR } from './utils/data-br.util';
import { CODIGOS_TPU_EXECUCAO, FASE_LABEL, faseDoProcesso } from './utils/fase.util';

/**
 * O DOSSIÊ DO PROCESSO — o papel que se entrega a quem perguntou.
 *
 * O filiado liga e pergunta "como está o meu processo?". Hoje a resposta é uma
 * pessoa lendo a tela em voz alta pelo telefone, ou um print de celular. Este é
 * o documento que responde: quem processa quem, quem responde pelo caso, há
 * quanto tempo tramita, em que fase está, o que andou e o que a casa fez.
 *
 * O QUE ELE NÃO LEVA, e cada ausência é decisão:
 *
 *  - NOTA INTERNA. `notaInterna` é o que a equipe escreve para a equipe —
 *    estratégia, dúvida sobre a tese, avaliação do caso. Nada disso vai num
 *    papel que sai do escritório. O filtro é na CONSULTA, não na montagem.
 *  - PROGNÓSTICO. Nenhuma linha diz se vai ganhar ou quanto tempo falta. O
 *    dossiê relata o que ACONTECEU; opinar sobre desfecho em documento entregue
 *    ao filiado é criar expectativa que ninguém pode honrar. "Tramita há 1 ano
 *    e 4 meses" é fato medido; "deve sair este ano" seria promessa.
 *  - O TEOR INTEGRAL das publicações. São até 22 mil caracteres cada; o dossiê
 *    lista os atos e suas datas, e quem quiser o inteiro teor pede a peça.
 *  - A AGENDA. Audiência marcada, prazo em aberto e desfecho de atividade são
 *    trabalho em curso da equipe, com observação livre e categoria de
 *    cancelamento — campos que ninguém escreveu pensando no filiado.
 *
 * A ADVERTÊNCIA SOBRE A FONTE é obrigatória e fecha o documento: os andamentos
 * vêm da base pública do CNJ, que ATRASA — mediana de 62 dias medida neste
 * acervo contra o D+0 do Diário. Um dossiê que se apresenta como espelho do
 * processo mente por omissão no dia em que o tribunal ainda não alimentou o
 * índice.
 *
 * ------------------------------------------------------------------------
 * COMO ESTE ARQUIVO É ORGANIZADO — o método é o de `web/src/lib/pdf-documento`
 *
 *  1. `planejarDossie()` é PURA: recebe dados e devolve o documento em blocos
 *     (rótulos já legíveis, datas já formatadas, avisos já redigidos). É o que
 *     o teste lê sem desenhar um traço.
 *  2. `desenhar()` só desenha. Toda medida passa por `cabe()` ANTES do bloco,
 *     então não existe título órfão nem linha de tabela partida ao meio.
 *  3. O rodapé é carimbado UMA VEZ, fora de qualquer laço: `carimbarRodape`
 *     já percorre todas as páginas. Chamá-lo por página imprimia N rodapés
 *     sobrepostos em cada folha — num documento de 4 páginas, 16 carimbos.
 */

// ---------------------------------------------------------------------------
// Vocabulário — o que o filiado lê no lugar do enum
// ---------------------------------------------------------------------------

/**
 * OS MESMOS RÓTULOS DA TELA. Espelham `STATUS_PROCESSO_LABEL` do web.
 *
 * O PDF imprimia `String(statusInterno).replace(/_/g, ' ')`, e o filiado
 * recebia "GANHO EXECUCAO" e "PRE PROCESSUAL" em papel timbrado. Enum é nome de
 * coluna, não palavra de português.
 *
 * `RASCUNHO` é o nome ANTIGO de `PRE_PROCESSUAL` e continua no banco (a
 * migração é aditiva de propósito — ver o enum no schema). Os dois têm de
 * aparecer IDÊNTICOS: são a mesma coisa para quem lê.
 */
export const SITUACAO_LABEL: Record<string, string> = {
  PRE_PROCESSUAL: 'Pré-processual',
  RASCUNHO: 'Pré-processual',
  PENDENTE: 'Pendente',
  ATIVO: 'Ativo',
  SUSPENSO: 'Suspenso',
  GANHO_EXECUCAO: 'Ganho — Execução',
  IMPROCEDENTE: 'Improcedente',
  ENCERRADO: 'Encerrado',
  ARQUIVADO: 'Arquivado',
};

/**
 * O GRAU POR EXTENSO. "TRT22 · G1" é como o índice do CNJ nomeia a instância;
 * ninguém fora do escritório sabe ler isso.
 *
 * Grau desconhecido volta como veio: um código estranho é melhor que um campo
 * vazio, porque avisa que apareceu coisa nova.
 */
export const GRAU_LABEL: Record<string, string> = {
  G1: '1º grau',
  G2: '2º grau',
  G3: '3º grau',
  G4: '4º grau',
  JE: 'Juizado Especial',
  TR: 'Turma Recursal',
  TST: 'TST',
  STJ: 'STJ',
  STF: 'STF',
  SUP: 'Instância superior',
};

export function rotuloDaSituacao(status: string | null | undefined): string {
  if (!status) return '—';
  return SITUACAO_LABEL[status] ?? status.replace(/_/g, ' ').toLowerCase();
}

export function rotuloDoGrau(grau: string | null | undefined): string {
  const chave = (grau ?? '').trim().toUpperCase();
  if (!chave) return '';
  return GRAU_LABEL[chave] ?? chave;
}

/** Papel padrão por polo — o mesmo de `PartesService`, para não haver dois. */
const PAPEL_PADRAO: Record<string, string> = {
  ATIVO: 'Autor',
  PASSIVO: 'Réu',
  TERCEIRO: 'Terceiro interessado',
};

const TITULO_DO_POLO: Record<string, string> = {
  ATIVO: 'Polo ativo — quem move a ação',
  PASSIVO: 'Polo passivo — contra quem a ação é movida',
  TERCEIRO: 'Terceiros e intervenientes',
};

// ---------------------------------------------------------------------------
// Cor da casa
// ---------------------------------------------------------------------------

/**
 * Cinza-grafite: a última rede, para uma instalação sem cor declarada. Hoje não
 * acontece — todo cliente traz `corInstitucional` no `tenant.config`, e o
 * compilador obriga o próximo a trazer também.
 */
export const GRAFITE = '#1F2937';

/**
 * A COR INSTITUCIONAL DESTA INSTALAÇÃO — e por que não há verde CRAVADO aqui.
 *
 * O arquivo trazia `#1B7F0A`, que é o verde do SENATEPI. O logo já respeita o
 * cliente (`lerLogoDaMarca`), então o documento do segundo sindicato saía com a
 * marca certa dentro de uma faixa verde do primeiro.
 *
 * A ORDEM É: o que o Administrador escolheu na tela de Identidade Visual; se
 * ele nunca abriu aquela tela, a cor DA CASA (`tenant.corInstitucional`); e só
 * numa instalação sem nenhuma das duas, o grafite.
 *
 * A QUEDA DEIXOU DE SER NEUTRA, e isto foi conserto do mesmo dia (18/09/2026).
 * Cair no cinza parecia a escolha segura — "documento na cor do sindicato
 * errado passa despercebido; sem cor, alguém conserta em trinta segundos". Só
 * que a produção do SENATEPI NÃO TEM linha em `identidade_visual`: o efeito
 * real seria o dossiê perder o verde que sempre teve, sem ninguém ter pedido.
 * A cor da casa não é palpite — vem do `tenant.config` do próprio cliente, o
 * mesmo lugar de onde saem o CNPJ e o rodapé, e ela nunca pode ser a de outro.
 *
 * COR CLARA DEMAIS É ESCURECIDA. A faixa recebe o logo BRANCO e o nome do
 * sindicato em branco; um amarelo escolhido na tela apagaria os dois. Escurecer
 * preserva a matiz e mantém o texto legível — errar aqui é entregar uma faixa
 * em branco.
 */
export function corInstitucional(corPrimaria: string | null | undefined): string {
  const hex = normalizarHex(corPrimaria) ?? normalizarHex(tenant.corInstitucional);
  if (!hex) return GRAFITE;
  const [r, g, b] = paraRgb(hex);
  // Luminância relativa aproximada (ITU-R BT.601) — barata e suficiente aqui.
  const luz = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luz <= 0.55) return hex;
  const fator = 0.5 / Math.max(luz, 0.001);
  return deRgb([r * fator, g * fator, b * fator]);
}

function normalizarHex(valor: string | null | undefined): string | null {
  const limpo = (valor ?? '').trim().replace(/^#/, '');
  const completo = limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo;
  return /^[0-9a-fA-F]{6}$/.test(completo) ? `#${completo.toUpperCase()}` : null;
}

function paraRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function deRgb([r, g, b]: number[]): string {
  const canal = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return `#${canal(r)}${canal(g)}${canal(b)}`;
}

/** Mistura a cor com branco. É assim que saem o filete claro e o fundo das tabelas. */
export function clarear(hex: string, parteDeBranco: number): string {
  const [r, g, b] = paraRgb(hex);
  const p = Math.max(0, Math.min(1, parteDeBranco));
  return deRgb([r + (255 - r) * p, g + (255 - g) * p, b + (255 - b) * p]);
}

// ---------------------------------------------------------------------------
// Saneamento de texto
// ---------------------------------------------------------------------------

const TROCAS: Record<string, string> = {
  '→': '->', '←': '<-', '⇒': '=>',
  '•': '·', '●': '·', '▪': '·',
  '✓': 'ok', '✔': 'ok', '✗': 'x', '✘': 'x',
  ' ': ' ', '​': '', '﻿': '',
  '‘': "'", '’': "'", '“': '"', '”': '"',
};

/**
 * O QUE A FONTE DO PDF SABE DESENHAR.
 *
 * As fontes padrão do PDFKit (Helvetica, Times) usam WinAnsiEncoding. O que não
 * estiver nela não vira um aviso: vira NADA, em silêncio — foi o que aconteceu
 * com seta e emoji no PDF dos Relatórios. E o texto aqui não é nosso: vem do
 * tribunal, que manda de tudo.
 *
 * Acentos passam (estão em WinAnsi). Quebra de linha do meio de uma descrição
 * vira espaço: a tabela mede altura, e um `\n` que ninguém contou empurra a
 * linha para fora da célula.
 */
export function sanear(texto: string | null | undefined): string {
  if (!texto) return '';
  const semQuebra = String(texto).normalize('NFC').replace(/\s*[\r\n]+\s*/g, ' ');
  let saida = '';
  for (const ch of semQuebra) {
    if (ch in TROCAS) {
      saida += TROCAS[ch];
      continue;
    }
    const c = ch.codePointAt(0)!;
    const emWinAnsi =
      (c >= 0x20 && c <= 0x7e) ||
      (c >= 0xa0 && c <= 0xff) ||
      c === 0x2013 || c === 0x2014 || c === 0x2026 || c === 0x20ac;
    saida += emWinAnsi ? ch : ' ';
  }
  return saida.replace(/ {2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Consulta — UMA definição, que é também o tipo
// ---------------------------------------------------------------------------

/** Quantos andamentos do tribunal entram. Acima disso vira listagem, não dossiê. */
export const MAX_ANDAMENTOS = 25;
/** Quantos registros de atuação entram. */
export const MAX_ATUACAO = 25;

/**
 * O SELECT É O TIPO — e era esse o defeito de `carregar()`.
 *
 * Havia um método privado `carregar()` que nunca era chamado: existia só para
 * `Awaited<ReturnType<...>>` dar um tipo ao desenho. Código morto que define o
 * contrato envelhece sozinho, e já tinha envelhecido — ele não pedia `take`,
 * não pedia ordenação e não filtrava nota interna, enquanto a consulta de
 * verdade fazia as três coisas. O tipo mentia sobre o dado.
 *
 * Com `satisfies` + `GetPayload`, a consulta e o tipo são o MESMO objeto.
 */
const DOSSIE_SELECT = {
  numeroCNJ: true,
  titulo: true,
  classeProcessual: true,
  assuntoPrincipal: true,
  tribunal: true,
  orgaoJulgador: true,
  dataDistribuicao: true,
  statusInterno: true,
  categoria: true,
  grau: true,
  formato: true,
  nivelSigilo: true,
  segredoJustica: true,
  tipoAcao: true,
  ultimoMovimentoEm: true,
  createdAt: true,
  filiado: { select: { nomeCompleto: true, matricula: true } },
  solicitadoPor: { select: { nomeCompleto: true } },
  instancias: {
    orderBy: [{ baixada: 'asc' }, { ultimoMovimentoEm: 'desc' }],
    select: { grau: true, tribunal: true, baixada: true, orgaoJulgador: true },
  },
  /**
   * A EQUIPE, e não o atalho. O ato do Diário intima todo mundo que está nos
   * autos; o DONO do caso é o `principal` de `processos_advogados`, nunca o
   * primeiro citado. `processos.advogado_id` é só o espelho dessa linha.
   */
  advogados: {
    orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }],
    select: {
      principal: true,
      advogado: { select: { nome: true, nomeExibicao: true, oab: true, oabUf: true } },
    },
  },
  partes: {
    orderBy: [{ polo: 'asc' }, { principal: 'desc' }, { createdAt: 'asc' }],
    select: {
      nome: true,
      polo: true,
      papel: true,
      principal: true,
      filiadoId: true,
      parteExterna: { select: { institucional: true } },
    },
  },
  movimentacoes: {
    orderBy: { dataMovimento: 'desc' },
    take: MAX_ANDAMENTOS,
    select: {
      dataMovimento: true,
      descricao: true,
      detalhe: true,
      // O GRAU do ato: "Conclusão" do 1º e do 2º grau lado a lado, sem nada que
      // os distinga, é a mesma lista ilegível que a ficha já tinha resolvido.
      instancia: { select: { grau: true } },
    },
  },
  /**
   * SÓ O QUE NÃO É NOTA INTERNA. O filtro é aqui, na consulta, e não na
   * montagem: nota interna que chega até o gerador é nota interna que alguém
   * pode vazar para o PDF numa alteração distraída.
   *
   * `origemSistema: false` tira a papelada do robô ("encerrado
   * automaticamente"): arquivar não é atuar.
   *
   * A ordem é a MESMA da ficha na tela (`movimentacoes.service.ts`), para o
   * papel trazer as mesmas linhas que a pessoa viu antes de mandar imprimir.
   * A ordem de IMPRESSÃO é refeita em memória — ver `ordenarAtuacao`.
   */
  movimentacoesInternas: {
    where: { notaInterna: false, origemSistema: false },
    orderBy: [{ dataFato: 'desc' }, { createdAt: 'desc' }],
    take: MAX_ATUACAO,
    select: { dataFato: true, createdAt: true, descricao: true, tipo: true },
  },
} satisfies Prisma.ProcessoSelect;

export type ProcessoDoDossie = Prisma.ProcessoGetPayload<{ select: typeof DOSSIE_SELECT }>;
type ParteDoDossie = ProcessoDoDossie['partes'][number];
type AtuacaoDoDossie = ProcessoDoDossie['movimentacoesInternas'][number];

// ---------------------------------------------------------------------------
// O plano — puro, e é o que o teste lê
// ---------------------------------------------------------------------------

export interface LinhaDeFicha {
  rotulo: string;
  valor: string;
}

export interface LinhaDeParte {
  papel: string;
  nome: string;
  /** "filiado", "o sindicato" — quem é quem, sem obrigar a decorar os nomes. */
  marca: string;
  principal: boolean;
}

export interface GrupoDePartes {
  titulo: string;
  linhas: LinhaDeParte[];
}

export interface LinhaDeAto {
  data: string;
  /** Grau do tribunal, ou o tipo do registro da equipe. Vazio quando não há. */
  faixa: string;
  texto: string;
}

export interface PlanoDoDossie {
  npu: string;
  titulo: string;
  /** Linha de identidade das páginas seguintes. */
  correnteza: string;
  sigilo: string | null;
  resumo: { rotulo: string; valor: string }[];
  identificacao: LinhaDeFicha[];
  partes: GrupoDePartes[];
  semPartes: string | null;
  equipe: LinhaDeFicha[];
  semEquipe: string | null;
  andamentos: LinhaDeAto[];
  avisoAndamentos: string | null;
  atuacao: LinhaDeAto[];
  avisoAtuacao: string | null;
  emissao: string;
}

export interface EntradaDoPlano {
  processo: ProcessoDoDossie;
  polos: { ativo: ParteDoDossie[]; passivo: ParteDoDossie[]; terceiros: ParteDoDossie[] };
  totalAndamentos: number;
  totalAtuacao: number;
  temMovimentoDeExecucao: boolean;
  /** slug de `tipos_movimentacao` → nome cadastrado. Slug cru não vai ao filiado. */
  nomeDosTipos: Map<string, string>;
  agora: Date;
  autor?: string | null;
}

const SEM_VALOR = '—';

/**
 * HÁ QUANTO TEMPO TRAMITA — em português, não em dias corridos.
 *
 * A pergunta que abre toda reunião é essa, e "distribuído em 14/05/2024" obriga
 * quem lê a fazer a conta. A mediana até a sentença neste acervo é de 306 dias:
 * é uma escala de ANOS, então ela é dita em anos e meses.
 *
 * A conta é em dia de calendário de Teresina (`diaBR`), e não em milissegundos:
 * o contêiner roda em UTC e um processo distribuído às 22h aparecia um dia mais
 * velho.
 */
export function tempoDeTramitacao(de: Date | null | undefined, ate: Date): string {
  if (!de) return SEM_VALOR;
  const [a1, m1, d1] = diaBR(de).split('-').map(Number);
  const [a2, m2, d2] = diaBR(ate).split('-').map(Number);
  const dias = Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
  if (dias < 0) return SEM_VALOR;
  if (dias === 0) return 'hoje';
  let meses = (a2 - a1) * 12 + (m2 - m1);
  if (d2 < d1) meses -= 1;
  if (meses < 1) return dias === 1 ? '1 dia' : `${dias} dias`;
  if (meses < 12) return meses === 1 ? '1 mês' : `${meses} meses`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAnos = anos === 1 ? '1 ano' : `${anos} anos`;
  if (!resto) return parteAnos;
  return `${parteAnos} e ${resto === 1 ? '1 mês' : `${resto} meses`}`;
}

/**
 * A ORDEM DE IMPRESSÃO DA ATUAÇÃO — pela data que o papel MOSTRA.
 *
 * O PDF ordenava por `createdAt` e imprimia `dataFato`: a audiência de quarta,
 * lançada na sexta, saía acima do despacho de quinta. Datas fora de ordem em
 * documento entregue ao filiado passam a impressão de erro no sistema inteiro.
 *
 * Nem a ordem da ficha resolve sozinha: `ORDER BY data_fato DESC` no Postgres é
 * NULLS FIRST, então o registro sem data do fato sobe ao topo da folha ainda
 * que tenha sido escrito ontem. Aqui a chave é uma só — `dataFato ?? createdAt`
 * —, que é exatamente o que a coluna de data imprime.
 */
export function ordenarAtuacao<T extends { dataFato: Date | null; createdAt: Date }>(
  lista: readonly T[],
): T[] {
  return [...lista].sort(
    (a, b) => (b.dataFato ?? b.createdAt).getTime() - (a.dataFato ?? a.createdAt).getTime(),
  );
}

/**
 * O AVISO DO CORTE — "há mais N, e até quando vai o que você está vendo".
 *
 * O corte em 25 era silencioso: a folha terminava e quem lia concluía que o
 * processo tinha parado ali. Um documento que esconde 178 andamentos sem dizer
 * uma palavra é pior que um documento longo.
 */
export function avisoDoCorte(
  total: number,
  mostrados: number,
  maisAntigo: string,
  oQue: { singular: string; plural: string },
): string | null {
  const restam = total - mostrados;
  if (restam <= 0) return null;
  const quantos = restam === 1 ? `Há mais 1 ${oQue.singular}` : `Há mais ${restam} ${oQue.plural}`;
  const traz = mostrados === 1 ? 'o mais recente' : `os ${mostrados} mais recentes`;
  return (
    `${quantos} antes de ${maisAntigo}. Esta relação traz ${traz} — ` +
    'o histórico completo pode ser pedido ao sindicato.'
  );
}

/** Monta o documento inteiro em blocos, sem desenhar um traço. */
export function planejarDossie(e: EntradaDoPlano): PlanoDoDossie {
  const p = e.processo;
  const npu = NpuUtils.formatar(p.numeroCNJ ?? '') || sanear(p.titulo) || 'Processo sem número';

  const emSegredo = p.segredoJustica || (p.nivelSigilo ?? 0) > 0;

  const fase = faseDoProcesso({
    instancias: p.instancias,
    temMovimentoDeExecucao: e.temMovimentoDeExecucao,
    semNumero: !p.numeroCNJ,
  });

  // ---- A tira que responde em cinco segundos ----
  const resumo = [
    { rotulo: 'Situação no sindicato', valor: rotuloDaSituacao(p.statusInterno) },
    { rotulo: 'Fase no tribunal', valor: FASE_LABEL[fase] },
    /**
     * "TRAMITA HÁ —" É UMA CÉLULA MORTA no caso pré-processual, que por
     * definição não tem distribuição. A pergunta continua valendo, só muda o
     * marco: quanto tempo o caso está na casa. 4 dos 155 processos ativos não
     * têm data de distribuição.
     */
    p.dataDistribuicao
      ? { rotulo: 'Tramita há', valor: tempoDeTramitacao(p.dataDistribuicao, e.agora) }
      : { rotulo: 'No sindicato há', valor: tempoDeTramitacao(p.createdAt, e.agora) },
    {
      rotulo: 'Último movimento',
      valor: p.ultimoMovimentoEm ? formatarDataBR(p.ultimoMovimentoEm) : SEM_VALOR,
    },
  ];

  // ---- Ficha de identificação ----
  const grauPrincipal = rotuloDoGrau(p.grau);
  const tribunal = [sanear(p.tribunal), grauPrincipal].filter(Boolean).join(' · ');
  const identificacao: LinhaDeFicha[] = [];
  const por = (rotulo: string, valor: string | null | undefined) => {
    const limpo = sanear(valor);
    if (limpo) identificacao.push({ rotulo, valor: limpo });
  };
  por('Classe processual', p.classeProcessual);
  por('Assunto', p.assuntoPrincipal);
  por('Área jurídica', p.categoria);
  por('Tribunal', tribunal);
  por('Órgão julgador', p.orgaoJulgador);
  if (p.instancias.length > 1) {
    por(
      'Instâncias',
      p.instancias
        .map((i) =>
          `${rotuloDoGrau(i.grau) || i.grau} (${sanear(i.tribunal)}, ${i.baixada ? 'baixada' : 'em curso'})`,
        )
        .join('; '),
    );
  }
  // O tempo de tramitação NÃO se repete aqui: já está na tira do topo, e
  // repetir o mesmo fato duas vezes na mesma folha é enchimento.
  por('Distribuído em', p.dataDistribuicao ? formatarDataBR(p.dataDistribuicao) : null);
  if (!p.dataDistribuicao) por('Cadastrado no sindicato em', formatarDataBR(p.createdAt));
  por('Autos', p.formato);
  if (p.tipoAcao === 'INSTITUCIONAL') {
    por('Natureza', `Ação institucional movida pelo ${tenant.sigla} em nome da categoria`);
  }

  // ---- Partes, TODOS os polos ----
  const marcaDa = (parte: ParteDoDossie): string => {
    if (parte.parteExterna?.institucional) return `o ${tenant.sigla}`;
    if (parte.filiadoId) return tenant.vocabulario.filiado;
    return '';
  };
  const grupo = (polo: string, lista: ParteDoDossie[]): GrupoDePartes | null => {
    if (!lista.length) return null;
    return {
      titulo: TITULO_DO_POLO[polo],
      linhas: lista.map((parte) => ({
        papel: sanear(parte.papel) || PAPEL_PADRAO[parte.polo] || 'Parte',
        nome: sanear(parte.nome) || SEM_VALOR,
        marca: marcaDa(parte),
        principal: parte.principal,
      })),
    };
  };
  const partes = [
    grupo('ATIVO', e.polos.ativo),
    grupo('PASSIVO', e.polos.passivo),
    // TERCEIROS SOMEM NÃO, e era o que acontecia: o PDF filtrava só ATIVO e
    // PASSIVO, então o Ministério Público e o litisconsorte não existiam para
    // quem lia o papel.
    grupo('TERCEIRO', e.polos.terceiros),
  ].filter((g): g is GrupoDePartes => g !== null);

  // ---- Quem responde pelo caso ----
  const equipe: LinhaDeFicha[] = [];
  const responsavel = p.advogados.find((a) => a.principal) ?? p.advogados[0] ?? null;
  const nomeDoAdvogado = (a: { nome: string; nomeExibicao: string | null; oab: string | null; oabUf: string | null }) => {
    const oab = a.oab ? ` (OAB ${[a.oab, a.oabUf].filter(Boolean).join('/')})` : '';
    return sanear(`${a.nomeExibicao || a.nome}${oab}`);
  };
  if (responsavel) equipe.push({ rotulo: 'Advogado responsável', valor: nomeDoAdvogado(responsavel.advogado) });
  const apoio = p.advogados.filter((a) => a !== responsavel);
  if (apoio.length) {
    equipe.push({
      rotulo: apoio.length === 1 ? 'Também atua' : 'Também atuam',
      valor: apoio.map((a) => nomeDoAdvogado(a.advogado)).join('; '),
    });
  }
  if (p.filiado) {
    const matricula = sanear(p.filiado.matricula);
    const rotulo = capitalizar(tenant.vocabulario.filiado);
    equipe.push({
      rotulo,
      valor: sanear(p.filiado.nomeCompleto) + (matricula ? ` — ${tenant.vocabulario.matricula} ${matricula}` : ''),
    });
  }
  if (p.solicitadoPor && p.solicitadoPor.nomeCompleto !== p.filiado?.nomeCompleto) {
    equipe.push({ rotulo: 'Procurou o sindicato', valor: sanear(p.solicitadoPor.nomeCompleto) });
  }

  // ---- Andamentos do tribunal ----
  const andamentos: LinhaDeAto[] = p.movimentacoes.map((m) => ({
    data: formatarDataBR(m.dataMovimento),
    faixa: rotuloDoGrau(m.instancia?.grau),
    texto: sanear([m.descricao, m.detalhe].filter(Boolean).join(' — ')) || SEM_VALOR,
  }));
  const maisAntigoDoTribunal = p.movimentacoes.length
    ? formatarDataBR(p.movimentacoes[p.movimentacoes.length - 1].dataMovimento)
    : '';
  const avisoAndamentos = maisAntigoDoTribunal
    ? avisoDoCorte(e.totalAndamentos, andamentos.length, maisAntigoDoTribunal, {
        singular: 'andamento',
        plural: 'andamentos',
      })
    : null;

  // ---- O que a casa fez ----
  const atuacaoOrdenada = ordenarAtuacao(p.movimentacoesInternas);
  const atuacao: LinhaDeAto[] = atuacaoOrdenada.map((m: AtuacaoDoDossie) => ({
    data: formatarDataBR(m.dataFato ?? m.createdAt),
    faixa: sanear(e.nomeDosTipos.get(m.tipo) ?? ''),
    texto: sanear(m.descricao) || SEM_VALOR,
  }));
  const maisAntigaDaCasa = atuacaoOrdenada.length
    ? formatarDataBR(
        atuacaoOrdenada[atuacaoOrdenada.length - 1].dataFato ??
          atuacaoOrdenada[atuacaoOrdenada.length - 1].createdAt,
      )
    : '';
  const avisoAtuacao = maisAntigaDaCasa
    ? avisoDoCorte(e.totalAtuacao, atuacao.length, maisAntigaDaCasa, {
        singular: 'registro de atuação',
        plural: 'registros de atuação',
      })
    : null;

  return {
    npu,
    titulo: 'ACOMPANHAMENTO PROCESSUAL',
    correnteza: `${tenant.sigla} · Acompanhamento processual`,
    sigilo: emSegredo
      ? 'SEGREDO DE JUSTIÇA — a circulação deste documento é restrita às partes e aos seus advogados.'
      : null,
    resumo,
    identificacao,
    partes,
    semPartes: partes.length ? null : 'Nenhuma parte cadastrada neste processo até esta data.',
    equipe,
    semEquipe: equipe.length ? null : 'Nenhum advogado vinculado a este processo até esta data.',
    andamentos,
    avisoAndamentos,
    atuacao,
    avisoAtuacao,
    emissao: [
      `Documento emitido em ${formatarDataHoraBR(e.agora)}`,
      e.autor ? `por ${sanear(e.autor)}` : '',
    ]
      .filter(Boolean)
      .join(' ') + '.',
  };
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const RODAPE = rodapeInstitucional();

const FONTE_CNJ =
  'Os andamentos aqui reproduzidos foram obtidos da base pública de dados processuais do ' +
  'Conselho Nacional de Justiça (DataJud) e do Diário de Justiça Eletrônico Nacional (DJEN). ' +
  'Essas bases têm atraso de alimentação pelos tribunais: a ausência de um ato nesta relação ' +
  'não significa que ele não tenha ocorrido. Este documento é informativo, não contém a ' +
  'avaliação interna da equipe sobre o caso e não substitui a consulta aos autos.';

// ---------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------

@Injectable()
export class DossieProcessoService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * A SEPARAÇÃO DOS POLOS SAI DAQUI, e não de um `filter` local. O filtro
     * local conhecia ATIVO e PASSIVO e ignorava TERCEIRO — uma segunda regra de
     * partes, escondida num gerador de PDF, discordando da tela.
     */
    private readonly partes: PartesService,
  ) {}

  async gerar(processoId: string, autor?: string | null): Promise<DocumentoGerado> {
    const processo = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: DOSSIE_SELECT,
    });
    if (!processo) throw new NotFoundException('Processo não encontrado.');

    const [totalAndamentos, totalAtuacao, execucao, tipos, cor] = await Promise.all([
      this.prisma.movimentacaoProcessual.count({ where: { processoId } }),
      this.prisma.movimentacaoInterna.count({
        where: { processoId, notaInterna: false, origemSistema: false },
      }),
      this.prisma.movimentacaoProcessual.count({
        where: { processoId, codigoMovimento: { in: [...CODIGOS_TPU_EXECUCAO] } },
      }),
      this.prisma.tipoAndamento.findMany({ select: { slug: true, nome: true } }),
      this.corDaCasa(),
    ]);

    const polos = this.partes.agruparPorPolo(processo.partes);
    const plano = planejarDossie({
      processo,
      polos,
      totalAndamentos,
      totalAtuacao,
      temMovimentoDeExecucao: execucao > 0,
      nomeDosTipos: new Map(tipos.map((t) => [t.slug, t.nome])),
      agora: new Date(),
      autor,
    });

    const pdf = await this.desenhar(plano, cor);
    return {
      pdf,
      nomeArquivo: nomeDeArquivo(['dossie', plano.npu, dataParaNome(new Date())], 'pdf'),
    };
  }

  /**
   * NUNCA EXPLODE POR CAUSA DE UMA COR. O dossiê é pedido no meio de um
   * atendimento; falhar a geração porque a tabela de identidade visual não
   * respondeu seria trocar um documento cinza por documento nenhum.
   */
  private async corDaCasa(): Promise<string> {
    try {
      const linha = await this.prisma.identidadeVisual.findUnique({
        where: { id: 'unica' },
        select: { corPrimaria: true },
      });
      return corInstitucional(linha?.corPrimaria);
    } catch {
      return GRAFITE;
    }
  }

  // -------------------------------------------------------------------------
  // Desenho
  // -------------------------------------------------------------------------

  private desenhar(plano: PlanoDoDossie, casa: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        // A margem de baixo reserva o rodapé: é ela que impede o texto de
        // encostar no filete e o PDFKit de abrir a folha fantasma.
        margins: { top: 50, bottom: 62, left: 50, right: 50 },
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const TINTA = '#111827';
      const TINTA_FRACA = '#4B5563';
      const CINZA = '#6B7280';
      const FILETE = '#D9DDE3';
      const AMBAR_TINTA = '#92400E';
      const AMBAR_FUNDO = '#FDF0D5';
      const TOM_FRACO = clarear(casa, 0.9);
      const TOM_MEDIO = clarear(casa, 0.45);
      const LISTRA = '#FAFAFA';

      const X = doc.page.margins.left;
      const W = doc.page.width - X - doc.page.margins.right;
      const LIMITE = doc.page.height - doc.page.margins.bottom;
      const logo = lerLogoDaMarca();

      /** Onde o conteúdo começa na página em que estamos. */
      let topo = 0;
      let y = 0;

      const fonte = (pontos: number, peso: 'n' | 'b' | 'i' = 'n', cor = TINTA) => {
        doc
          .font(peso === 'b' ? 'Helvetica-Bold' : peso === 'i' ? 'Helvetica-Oblique' : 'Helvetica')
          .fontSize(pontos)
          .fillColor(cor);
      };

      const faixaCompleta = () => {
        const ALT = 78;
        doc.rect(0, 0, doc.page.width, ALT).fill(casa);
        let usouLogo = false;
        if (logo) {
          try {
            doc.image(logo, X, 19, { fit: [148, 40] });
            usouLogo = true;
          } catch {
            /* segue sem logo */
          }
        }
        if (!usouLogo) {
          // A IDENTIDADE NUNCA DEPENDE DO ARQUIVO. Sem o PNG da marca, a sigla
          // da instalação ocupa o lugar dele — um papel sem nenhum nome de
          // sindicato não se entrega a ninguém.
          doc.font('Helvetica-Bold').fontSize(19).fillColor('#FFFFFF')
            .text(tenant.sigla, X, 28, { width: 220, lineBreak: false });
        }
        doc.font('Helvetica').fontSize(7.5).fillColor(clarear(casa, 0.82))
          .text(`${tenant.nome}\nCNPJ ${tenant.cnpj}`, X + W - 250, 22, {
            align: 'right',
            width: 250,
            lineGap: 1.5,
          });
        doc.rect(0, ALT, doc.page.width, 4).fill(TOM_MEDIO);
        return ALT + 4 + 26;
      };

      /**
       * DA PÁGINA 2 EM DIANTE O DOCUMENTO CONTINUAVA SEM NOME.
       *
       * Folha solta de um dossiê de quatro páginas não dizia de que sindicato
       * era nem de que processo — e é justamente a folha dos andamentos, a que
       * alguém destaca para levar à reunião.
       */
      const faixaCompacta = () => {
        doc.rect(0, 0, doc.page.width, 5).fill(casa);
        doc.font('Helvetica').fontSize(7.5).fillColor(CINZA)
          .text(plano.correnteza, X, 18, { width: W * 0.58, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TINTA)
          .text(plano.npu, X + W * 0.58, 18, { width: W * 0.42, align: 'right', lineBreak: false });
        let base = 32;
        if (plano.sigilo) {
          doc.font('Helvetica-Bold').fontSize(6.5).fillColor(AMBAR_TINTA)
            .text('SEGREDO DE JUSTIÇA', X, base, { width: W, lineBreak: false });
          base += 11;
        }
        doc.moveTo(X, base).lineTo(X + W, base).lineWidth(0.5).strokeColor(FILETE).stroke();
        return base + 16;
      };

      /*
        UM SÓ LUGAR CRIA IDENTIDADE DE PÁGINA. O ouvinte pega tanto a quebra que
        eu peço quanto a que o PDFKit decide sozinho — sem ele, bastaria um
        parágrafo mal medido para nascer uma folha anônima.

        A primeira página NÃO passa por aqui: o PDFKit a cria dentro do
        construtor, antes de haver ouvinte. É o que queremos — ela leva a faixa
        inteira.
      */
      doc.on('pageAdded', () => {
        y = faixaCompacta();
        topo = y;
        fonte(9);
      });

      const novaPagina = () => doc.addPage();
      /** Quebra ANTES de começar o que não cabe — nunca no meio, nunca no topo. */
      const cabe = (altura: number) => {
        if (y + altura > LIMITE && y > topo + 0.5) novaPagina();
      };
      const alturaDe = (texto: string, largura: number, pontos: number, peso: 'n' | 'b' | 'i' = 'n') => {
        fonte(pontos, peso);
        return doc.heightOfString(texto || ' ', { width: largura });
      };
      /**
       * O MAIOR CORPO EM QUE O VALOR CABE NUMA LINHA SÓ.
       *
       * A tira do topo tem altura fixa, e "Ganho — Execução" numa célula de um
       * quarto da folha quebrava em duas linhas: a segunda saía por baixo do
       * fundo, meia letra cortada. Encolher a fonte é mais honesto do que
       * cortar a palavra — e só quando nem o menor corpo couber é que entram as
       * reticências.
       */
      const escalar = (texto: string, largura: number, corpos: number[], peso: 'n' | 'b' = 'n') => {
        for (const corpo of corpos) {
          fonte(corpo, peso);
          if (doc.widthOfString(texto) <= largura) return corpo;
        }
        return corpos[corpos.length - 1];
      };

      y = faixaCompleta();
      topo = y;

      // ---- Capa ----
      doc.font('Times-Bold').fontSize(19).fillColor(TINTA)
        .text(plano.titulo, X, y, { width: W, align: 'center', lineBreak: false });
      y += 25;
      doc.font('Times-Roman').fontSize(13).fillColor(TINTA_FRACA)
        .text(plano.npu, X, y, { width: W, align: 'center', lineBreak: false });
      y += 22;

      if (plano.sigilo) {
        const alt = alturaDe(plano.sigilo, W - 20, 8.5, 'b') + 12;
        doc.rect(X, y, W, alt).fill(AMBAR_FUNDO);
        doc.rect(X, y, 3, alt).fill(AMBAR_TINTA);
        fonte(8.5, 'b', AMBAR_TINTA);
        doc.text(plano.sigilo, X + 12, y + 6, { width: W - 20 });
        y += alt + 14;
      }

      // ---- A tira de resumo: quatro células, uma régua, sem cartão ----
      {
        const ALT = 44;
        const largura = W / plano.resumo.length;
        doc.rect(X, y, W, ALT).fill(TOM_FRACO);
        plano.resumo.forEach((celula, i) => {
          const cx = X + i * largura;
          if (i > 0) {
            doc.moveTo(cx, y + 7).lineTo(cx, y + ALT - 7).lineWidth(0.5).strokeColor(TOM_MEDIO).stroke();
          }
          fonte(6.5, 'b', CINZA);
          doc.text(celula.rotulo.toUpperCase(), cx + 10, y + 9, {
            width: largura - 20,
            characterSpacing: 0.4,
            lineBreak: false,
          });
          const corpo = escalar(celula.valor, largura - 20, [11.5, 10.5, 9.5, 8.5], 'b');
          fonte(corpo, 'b', TINTA);
          doc.text(celula.valor, cx + 10, y + 23 - corpo * 0.1, {
            width: largura - 20,
            lineBreak: false,
            ellipsis: true,
          });
        });
        y += ALT + 16;
      }

      const secao = (titulo: string, minimo = 40) => {
        cabe(24 + minimo);
        fonte(9.5, 'b', casa);
        doc.text(titulo.toUpperCase(), X, y, { width: W, characterSpacing: 0.5, lineBreak: false });
        y += 13;
        doc.moveTo(X, y).lineTo(X + W, y).lineWidth(1).strokeColor(TOM_MEDIO).stroke();
        y += 9;
      };

      const umaLinha = (texto: string) => {
        const alt = alturaDe(texto, W, 8.5, 'i');
        cabe(alt + 4);
        fonte(8.5, 'i', CINZA);
        doc.text(texto, X, y, { width: W });
        y += alt + 6;
      };

      /**
       * A TABELA — colunas de largura fixa, texto medido antes de sair.
       *
       * É o que substitui o "Rótulo: valor" solto com `continued: true`: aquele
       * desenho não sabia a altura do que ia escrever, então não tinha como
       * decidir quebrar a página antes — e partia a linha ao meio.
       */
      const tabela = (
        colunas: { largura: number; peso?: 'n' | 'b'; cor?: string; corpo?: number }[],
        cabecalho: string[] | null,
        linhas: string[][],
        opcoes: { listras?: boolean; fundoDoRotulo?: boolean; secao?: string } = {},
      ) => {
        const PAD = 6;
        const CORPO = 8.5;
        let continuacao = false;
        const desenharCabecalho = () => {
          // Quem vira a folha cai numa grade de datas sem nome. O título da
          // seção volta marcado como continuação — e não repetido inteiro, que
          // faria parecer que começou outra lista.
          if (continuacao && opcoes.secao) {
            fonte(8, 'b', TINTA_FRACA);
            doc.text(`${opcoes.secao} (continuação)`, X, y, { width: W, lineBreak: false });
            y += 12;
          }
          if (!cabecalho) return;
          const alt = 16;
          cabe(alt + 14);
          doc.rect(X, y, W, alt).fill(TOM_FRACO);
          let cx = X;
          cabecalho.forEach((texto, i) => {
            fonte(7, 'b', TINTA_FRACA);
            doc.text(texto.toUpperCase(), cx + PAD, y + 5, {
              width: colunas[i].largura - 2 * PAD,
              characterSpacing: 0.3,
              lineBreak: false,
            });
            cx += colunas[i].largura;
          });
          y += alt;
        };
        desenharCabecalho();

        linhas.forEach((linha, iLinha) => {
          const alturas = linha.map((celula, i) =>
            alturaDe(celula, colunas[i].largura - 2 * PAD, colunas[i].corpo ?? CORPO, colunas[i].peso ?? 'n'),
          );
          const alt = Math.max(...alturas, 11) + 2 * 3;
          const antes = y;
          cabe(alt);
          // Quebrou? O cabeçalho volta: tabela sem cabeçalho na folha 2 é uma
          // grade de números sem nome.
          if (y !== antes) {
            continuacao = true;
            desenharCabecalho();
          }

          if (opcoes.listras && iLinha % 2 === 1) doc.rect(X, y, W, alt).fill(LISTRA);
          if (opcoes.fundoDoRotulo) doc.rect(X, y, colunas[0].largura, alt).fill(LISTRA);

          let cx = X;
          linha.forEach((celula, i) => {
            fonte(colunas[i].corpo ?? CORPO, colunas[i].peso ?? 'n', colunas[i].cor ?? TINTA);
            doc.text(celula, cx + PAD, y + 3, { width: colunas[i].largura - 2 * PAD });
            cx += colunas[i].largura;
          });
          y += alt;
          doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.4).strokeColor(FILETE).stroke();
        });
        y += 8;
      };

      // ---- Identificação ----
      secao('Identificação do processo');
      if (plano.identificacao.length) {
        tabela(
          [{ largura: 132, peso: 'b', cor: TINTA_FRACA }, { largura: W - 132 }],
          null,
          plano.identificacao.map((l) => [l.rotulo, l.valor]),
          { fundoDoRotulo: true },
        );
      } else {
        umaLinha('Sem metadados do tribunal para este caso até esta data.');
      }

      // ---- Partes ----
      secao('Partes do processo');
      if (plano.semPartes) {
        umaLinha(plano.semPartes);
      } else {
        for (const g of plano.partes) {
          cabe(34);
          fonte(8, 'b', TINTA_FRACA);
          doc.text(g.titulo, X, y, { width: W, lineBreak: false });
          y += 12;
          tabela(
            [{ largura: 118, cor: CINZA, corpo: 8 }, { largura: W - 118 }],
            null,
            g.linhas.map((l) => [
              l.papel,
              l.marca ? `${l.nome}  (${l.marca})` : l.nome,
            ]),
            { listras: true },
          );
        }
      }

      // ---- Equipe ----
      secao('Quem responde pelo caso');
      if (plano.semEquipe) {
        umaLinha(plano.semEquipe);
      } else {
        tabela(
          [{ largura: 132, peso: 'b', cor: TINTA_FRACA }, { largura: W - 132 }],
          null,
          plano.equipe.map((l) => [l.rotulo, l.valor]),
          { fundoDoRotulo: true },
        );
      }

      // ---- Andamentos do tribunal ----
      secao('Andamentos no tribunal');
      if (!plano.andamentos.length) {
        umaLinha('Nenhum andamento registrado na base pública até esta data.');
      } else {
        tabela(
          [{ largura: 62, peso: 'b', corpo: 8 }, { largura: 74, cor: CINZA, corpo: 8 }, { largura: W - 136 }],
          ['Data', 'Grau', 'Ato praticado'],
          plano.andamentos.map((a) => [a.data, a.faixa || SEM_VALOR, a.texto]),
          { listras: true, secao: 'Andamentos no tribunal' },
        );
      }
      if (plano.avisoAndamentos) umaLinha(plano.avisoAndamentos);

      // ---- O que a casa fez ----
      secao('Atuação do sindicato');
      if (!plano.atuacao.length) {
        umaLinha('Sem registros de atuação lançados até esta data.');
      } else {
        tabela(
          [{ largura: 62, peso: 'b', corpo: 8 }, { largura: 100, cor: CINZA, corpo: 8 }, { largura: W - 162 }],
          ['Data', 'Tipo', 'O que foi feito'],
          plano.atuacao.map((a) => [a.data, a.faixa || SEM_VALOR, a.texto]),
          { listras: true, secao: 'Atuação do sindicato' },
        );
      }
      if (plano.avisoAtuacao) umaLinha(plano.avisoAtuacao);

      // ---- Emissão e advertência sobre a fonte ----
      {
        const altAviso = alturaDe(FONTE_CNJ, W - 20, 7.5);
        const altEmissao = alturaDe(plano.emissao, W, 8);
        const altDoFecho = altEmissao + 8 + altAviso + 14;
        const ondeEstava = y;
        cabe(altDoFecho + 2);
        /*
          SE O FECHO PRECISOU DE FOLHA NOVA, ELE VAI PARA O PÉ DELA.

          A advertência sobre a fonte é o fecho do documento, não o começo de
          uma seção. Empurrada para o alto de uma folha quase vazia — que é o
          que acontece quando a última linha da tabela termina a dois
          centímetros da margem —, ela parece sobra de diagramação, e a folha
          parece a "página em branco" que o rodapé já causou uma vez. No pé, a
          mesma folha lê como a última.
        */
        if (y !== ondeEstava) y = LIMITE - altDoFecho;
        fonte(8, 'n', TINTA_FRACA);
        doc.text(plano.emissao, X, y, { width: W });
        y += altEmissao + 8;
        doc.rect(X, y, W, altAviso + 14).fill('#F7F8F9');
        fonte(7.5, 'n', CINZA);
        // Sem justificar: em 7,5pt numa caixa estreita o texto justificado abre
        // rios de espaço entre as palavras, que é o que faz um papel parecer
        // montado por máquina.
        doc.text(FONTE_CNJ, X + 10, y + 7, { width: W - 20, lineGap: 1 });
        y += altAviso + 14;
      }

      /*
        UMA VEZ, FORA DO LAÇO.

        `carimbarRodape` já percorre `bufferedPageRange()` inteiro. A chamada
        antiga estava DENTRO de um laço por página: num documento de 4 folhas
        saíam 16 carimbos, quatro por folha, e os quatro "página N de 4"
        impressos exatamente um sobre o outro. Bastavam 25 andamentos para o
        dossiê ter duas páginas — acontecia na prática, não em teoria.
      */
      carimbarRodape(doc, RODAPE, { numerarPaginas: true, corDaLinha: FILETE });
      doc.end();
    });
  }
}
