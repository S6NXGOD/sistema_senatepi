import { StatusProcesso } from '@prisma/client';
import { diaBR } from './data-br.util';
import { STATUS_VIVOS } from './varredura.util';

/**
 * ATÉ ONDE O DIÁRIO JÁ FOI LIDO — as regras puras da leitura do DJEN.
 *
 * Moram aqui, fora do serviço, porque cada uma delas decide se um ato do Diário
 * chega ou some para sempre, e decisão desse tamanho precisa de teste com
 * valores, não com o texto do fonte. O serviço só lê o banco, chama estas
 * funções e grava o carimbo que elas mandam gravar.
 *
 * TODAS AS DATAS AQUI SÃO DIAS DE TERESINA NO FORMATO `AAAA-MM-DD`. A API do CNJ
 * pede o dia assim, e comparar texto de dia com texto de dia não tem fuso para
 * errar. O instante (Date) só entra pelas bordas: `diaBR` para timestamp e
 * `diaDaColunaDate` para coluna `@db.Date`, que chega como meia-noite UTC e
 * andaria um dia para trás se passasse por `diaBR` (memória "data pura").
 */

/** Sobreposição da rodada diária: absorve fim de semana, feriado e uma noite perdida. */
export const DJEN_SOBREPOSICAO_DIAS = 3;

/**
 * TETO DA RECUPERAÇÃO AUTOMÁTICA, em dias.
 *
 * Sessenta dias × ~113 atos por dia somando as oito OABs ≈ 7 mil itens, ~70
 * páginas, uns 5 minutos de cota: cabe folgado no TTL de 180 minutos da trava.
 * Mais que isso depois de uma queda longa é colheita, e colheita é pedida à mão
 * (`dias` até 180 na rota do Administrador).
 */
export const DJEN_TETO_RECUPERACAO_DIAS = 60;

/**
 * HISTÓRICO POR NÚMERO: quantos processos por noite, e quantas páginas cada um.
 *
 * Medido em 14/09/2026: nos 37 processos cadastrados depois da carga de 04/09,
 * só 38,4% dos dias com publicação registrada no DataJud tinham ato do DJEN no
 * banco, contra 84,5% nos anteriores. O histórico deles nunca foi colhido.
 *
 * 200 POR NOITE, e não 40 (14/09/2026). A simulação contra a produção terminou:
 * 153 processos vivos, 153 chamadas, 0 erro e nenhum no teto de páginas; 1.446
 * atos na origem, 210 faltando no banco, só 7 deles com 30 dias ou menos. Com
 * 200 o acervo vivo inteiro é colhido na primeira noite, e depois sobra só o
 * fluxo de cadastro (1 a 5 processos por dia).
 *
 * A CONTA DE TEMPO, refeita em 15/09/2026 (a de antes dizia ~300 chamadas e
 * ~22 minutos). Quem lê o histórico sai da janela na mesma noite, então a
 * primeira noite troca a janela desses 153 pelo histórico e fica em ~13
 * minutos; a noite normal fica em ~170–185 chamadas, uns 12 a 14 minutos a 14
 * por minuto.
 *
 * QUEM PROTEGE A TRAVA É O LIMITE DE TEMPO, não este padrão. Com tudo no teto
 * de páginas (8×20 + 200×10 + 300×3 = 3.060 chamadas) a rodada levaria ~220
 * minutos, acima dos 180 da trava; `DJEN_ORCAMENTO_DA_RODADA_MIN` para a
 * rodada antes disso.
 *
 * As DUAS continuam ajustáveis por ambiente (`DJEN_HISTORICO_POR_RODADA` e
 * `DJEN_HISTORICO_MAX_PAGINAS`): mudar precisa ser variável e restart.
 */
export const DJEN_HISTORICO_POR_RODADA_PADRAO = 200;
export const DJEN_HISTORICO_MAX_PAGINAS_PADRAO = 10;

/**
 * O ORÇAMENTO DE TEMPO DA RODADA, em minutos (15/09/2026).
 *
 * A trava do job vale 180 minutos. Se a rodada passasse disso, a trava se
 * soltaria com ela ainda correndo, e a próxima (o robô do dia seguinte, ou o
 * botão do Administrador) entraria disputando a mesma cota do CNJ. Nenhuma
 * noite real chega perto (~13 minutos), mas o pior caso teórico chega a ~220.
 *
 * 150 deixa meia hora para o que vem depois das consultas: correlação, rede
 * das propostas, advogados e partes do ato, a conferência da fila no DataJud
 * (até 40 ações) e a tarefa de cadastro. O que para aqui são as passadas 2
 * (histórico) e 3 (janela pelo número); a OAB, que descobre ação nova, roda
 * inteira antes delas. Quem ficou para trás não ganhou carimbo e entra primeiro
 * na noite seguinte: o histórico continua nulo, e a janela ordena pela
 * consulta mais antiga.
 */
export const DJEN_ORCAMENTO_DA_RODADA_MIN = 150;

/** A rodada iniciada em `iniciadaEm` (ms) já gastou o orçamento em `agora` (ms)? */
export function passouDoOrcamento(
  iniciadaEm: number,
  agora: number,
  orcamentoMin: number = DJEN_ORCAMENTO_DA_RODADA_MIN,
): boolean {
  return agora - iniciadaEm >= orcamentoMin * 60_000;
}

/** Um período de leitura do Diário, em dias de Teresina (inclusivos). */
export interface JanelaDeLeitura {
  de: string;
  ate: string;
  /** Quantos dias para trás a partir de `ate` (hoje − de). */
  dias: number;
  /** A janela passou da sobreposição normal porque havia leitura atrasada. */
  recuperando: boolean;
  /** O atraso passava do teto e os dias mais antigos que ele ficaram de fora. */
  cortadaNoTeto: boolean;
}

const DIA_MS = 24 * 3_600_000;

function paraUtc(dia: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw new Error(`Dia fora do formato AAAA-MM-DD: "${dia}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `2026-09-02` + (−3) → `2026-08-30`. Conta de calendário, sem relógio. */
export function somarDiasAoDia(dia: string, dias: number): string {
  return new Date(paraUtc(dia) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Dias de `de` até `ate` (positivo quando `ate` é depois). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / DIA_MS);
}

/**
 * O DIA GUARDADO NUMA COLUNA `@db.Date` — sem passar por fuso.
 *
 * O Postgres devolve a coluna `date` como meia-noite UTC. `diaBR` tiraria três
 * horas e devolveria o dia anterior: o carimbo "lido até 14/09" viraria 13/09 e
 * a rodada releria um dia a mais para sempre (100% dos 597 registros da
 * memória "data pura" andavam para trás exatamente assim).
 */
export function diaDaColunaDate(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

/** O valor a gravar numa coluna `@db.Date` para um dia de Teresina. */
export function colunaDateDoDia(dia: string): Date {
  return new Date(paraUtc(dia));
}

/**
 * A JANELA DA OAB — de `min(hoje − sobreposição, lidoAte − 1)` até hoje.
 *
 * Três noites seguidas sem a ponte, um certificado vencido ou um deploy às
 * 05:00 faziam os atos desses dias sumirem da via OAB para sempre: a janela era
 * fixa e nada registrava até que dia cada OAB tinha sido lida. Com o carimbo, a
 * noite seguinte relê desde o dia anterior à última leitura boa.
 *
 * - `lidoAte` nulo (nunca carimbado, ou o contêiner antigo na janela de troca):
 *   só a sobreposição. Sem isto, a primeira noite depois do deploy dispararia
 *   uma colheita de 60 dias para cada OAB.
 * - O atraso maior que o teto é cortado no teto e sinalizado. Com a leitura
 *   boa o carimbo avança mesmo assim: sem avançar, a OAB ficaria presa relendo
 *   60 dias toda noite e nunca sairia do atraso.
 * - `sobreposicao` maior que o normal é a colheita pedida à mão (1 a 180 dias):
 *   ela manda, e o teto sobe junto para não cortar o que foi pedido.
 */
export function janelaDaOab(
  hoje: string,
  lidoAte: string | null,
  opcoes: { sobreposicao?: number; teto?: number } = {},
): JanelaDeLeitura {
  const sobreposicao = opcoes.sobreposicao ?? DJEN_SOBREPOSICAO_DIAS;
  const teto = Math.max(opcoes.teto ?? DJEN_TETO_RECUPERACAO_DIAS, sobreposicao);

  const normal = somarDiasAoDia(hoje, -sobreposicao);
  const desdeOCarimbo = lidoAte ? somarDiasAoDia(lidoAte, -1) : normal;
  const pedido = desdeOCarimbo < normal ? desdeOCarimbo : normal;

  const limite = somarDiasAoDia(hoje, -teto);
  const cortadaNoTeto = pedido < limite;
  const de = cortadaNoTeto ? limite : pedido;

  return { de, ate: hoje, dias: diasEntre(de, hoje), recuperando: de < normal, cortadaNoTeto };
}

/**
 * A JANELA DA CONSULTA POR NÚMERO — desde a última consulta, menos a sobreposição.
 *
 * Confirmado pela ponte em 13/09/2026: o CNJ respeita `dataDisponibilizacaoInicio`
 * junto com `numeroProcesso` (25 itens caíram para 2). Então o processo vivo
 * pode ser consultado toda noite por uma requisição só, em vez de relê-lo
 * inteiro: é o que fecha o furo de "uma publicação achada tira o processo da
 * consulta por 30 dias".
 *
 * `ultimaConsulta` é timestamp, e por isso passa por `diaBR`: a consulta das
 * 23:30 de Teresina já é o dia seguinte em UTC. Nula, lê a sobreposição.
 */
export function janelaDoNumero(
  hoje: string,
  ultimaConsulta: Date | null,
  opcoes: { sobreposicao?: number; teto?: number } = {},
): JanelaDeLeitura {
  const sobreposicao = opcoes.sobreposicao ?? DJEN_SOBREPOSICAO_DIAS;
  const teto = Math.max(opcoes.teto ?? DJEN_TETO_RECUPERACAO_DIAS, sobreposicao);

  const normal = somarDiasAoDia(hoje, -sobreposicao);
  const base = ultimaConsulta ? somarDiasAoDia(diaBR(ultimaConsulta), -sobreposicao) : normal;
  const pedido = base < normal ? base : normal;
  const limite = somarDiasAoDia(hoje, -teto);
  const cortadaNoTeto = pedido < limite;
  const de = cortadaNoTeto ? limite : pedido;
  const dias = diasEntre(de, hoje);

  // Consultado ontem, a janela já tem sobreposição + 1 dia (a regra é "desde a
  // última consulta menos 3"). Só é recuperação o que passa disso.
  return { de, ate: hoje, dias, recuperando: dias > sobreposicao + 1, cortadaNoTeto };
}

/**
 * O CARIMBO SÓ AVANÇA QUANDO A LEITURA FOI INTEIRA.
 *
 * Bater no teto de páginas quer dizer que havia mais do que foi lido; parar no
 * meio por falha quer dizer o mesmo. Nos dois casos gravar "lido até hoje"
 * afirmaria o que não aconteceu, e a noite seguinte começaria depois do
 * buraco. Sem o carimbo, a noite seguinte relê o período e o `hash` único
 * descarta o que já entrou.
 */
export function podeCarimbar(leitura: { bateuNoTeto: boolean; interrompidaPor: string | null }): boolean {
  return !leitura.bateuNoTeto && !leitura.interrompidaPor;
}

/**
 * A OAB DÁ PARA CONSULTAR?
 *
 * A mesma regra de `DjenService.lerPorOab`, escrita antes da chamada. O filtro
 * do banco era `oab: { not: null }`, e OAB com texto vazio passava: a consulta
 * recusava com 400, a noite contava uma falha, e a pessoa nunca aparecia como
 * "sem OAB". Vazio, só espaço ou UF que não tem duas letras é o mesmo que não ter.
 */
export function oabConsultavel(oab: string | null | undefined, uf: string | null | undefined): boolean {
  const numero = (oab ?? '').replace(/\D/g, '');
  const sigla = (uf ?? '').trim().toUpperCase();
  return numero.length > 0 && /^[A-Z]{2}$/.test(sigla);
}

/**
 * O QUE FALTA NA OAB — `null` quando dá para consultar (15/09/2026).
 *
 * A tela de Usuários dizia "Sem OAB no cadastro" também para quem tem o número
 * e esqueceu a UF, e a pessoa ia conferir um número que estava lá. `UF` só
 * quando o número existe: sem número, o que falta é a OAB inteira.
 */
export function faltaNaOab(oab: string | null | undefined, uf: string | null | undefined): 'OAB' | 'UF' | null {
  if (oabConsultavel(oab, uf)) return null;
  return (oab ?? '').replace(/\D/g, '').length > 0 ? 'UF' : 'OAB';
}

/**
 * NÚMERO DO AMBIENTE, sem transformar erro de digitação em comportamento.
 *
 * `Number(x) || padrao` não aceita zero, e zero é exatamente o valor útil para
 * DESLIGAR a colheita de histórico numa emergência sem novo deploy. Texto que
 * não é inteiro volta ao padrão; acima do máximo, fica no máximo.
 */
export function inteiroDoAmbiente(
  valor: unknown,
  padrao: number,
  limites: { min: number; max: number },
): number {
  if (valor === undefined || valor === null || String(valor).trim() === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < limites.min) return padrao;
  return Math.min(n, limites.max);
}

/** Uma pessoa da equipe do processo, como a cobertura precisa. */
export interface MembroDaEquipe {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  ativo: boolean;
  oab: string | null;
  oabUf: string | null;
  principal: boolean;
}

export interface CoberturaDoDiario {
  /** Quem da equipe traz as intimações pela OAB (ativo e com OAB consultável), principal primeiro. */
  porOab: { id: string; nome: string }[];
  /** Instante da última consulta pelo número (ISO), ou nulo. */
  ultimaConsultaNumero: string | null;
  /** Instante em que o histórico foi lido pelo número (ISO), ou nulo. */
  historicoLidoEm: string | null;
  /** Com que frequência o número é consultado; nulo sem número. */
  frequenciaDoNumero: 'TODA_NOITE' | 'SEMANAL' | null;
  /** As frases da linha de estado, na ordem, prontas para a tela. */
  linhas: string[];
}

/** "A", "A e B", "A, B e C". */
function listaDeNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** "12/09" no ano corrente de Teresina; "12/09/2025" fora dele. */
function diaCurto(instante: Date, agora: Date): string {
  const [ano, mes, dia] = diaBR(instante).split('-');
  return ano === diaBR(agora).slice(0, 4) ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
}

/**
 * A LINHA DE COBERTURA DA ABA PUBLICAÇÕES — calculada aqui, e não na tela.
 *
 * A pergunta que ela responde é "se sair uma intimação neste processo amanhã,
 * ela chega?". A resposta depende de três fatos que só o servidor tem juntos: a
 * equipe com OAB consultável, o status (vivo é toda noite, dormente é a cada 7
 * dias) e os dois carimbos da consulta por número. É estado, nunca alarme: sem
 * cor de alerta, sem botão de fechar.
 */
export function coberturaDoDiario(entrada: {
  numeroCNJ: string | null;
  statusInterno: StatusProcesso;
  temInstanciaViva: boolean;
  equipe: MembroDaEquipe[];
  ultimaConsultaDjen: Date | null;
  djenHistoricoLidoEm: Date | null;
  agora: Date;
}): CoberturaDoDiario {
  const porOab = entrada.equipe
    .filter((m) => m.ativo && oabConsultavel(m.oab, m.oabUf))
    .sort((a, b) => Number(b.principal) - Number(a.principal))
    .map((m) => ({ id: m.id, nome: m.nomeExibicao || m.nome }));

  const ultimaConsultaNumero = entrada.ultimaConsultaDjen?.toISOString() ?? null;
  const historicoLidoEm = entrada.djenHistoricoLidoEm?.toISOString() ?? null;

  if (!entrada.numeroCNJ) {
    return {
      porOab,
      ultimaConsultaNumero,
      historicoLidoEm,
      frequenciaDoNumero: null,
      linhas: [
        'Sem número do processo: o Diário só pode ser consultado depois da distribuição.',
      ],
    };
  }

  const vivo =
    STATUS_VIVOS.includes(entrada.statusInterno) ||
    (entrada.statusInterno === StatusProcesso.ENCERRADO && entrada.temInstanciaViva);
  const frequenciaDoNumero = vivo ? 'TODA_NOITE' : 'SEMANAL';
  const quando = vivo ? 'toda noite' : 'a cada 7 dias';

  /*
    A PRIMEIRA LINHA É A PRINCIPAL e a tela a mostra sozinha, com as outras
    abaixo (15/09/2026). No processo dormente ela dizia só "e pelo número do
    processo", como se fosse toda noite; agora diz "a cada 7 dias", como a
    frase sem OAB já dizia.
  */
  const linhas: string[] = [
    porOab.length
      ? `Acompanhado no Diário pela OAB de ${listaDeNomes(porOab.map((p) => p.nome))} e pelo número do processo` +
        `${vivo ? '' : ', a cada 7 dias'}.`
      : `Nenhum advogado da equipe com OAB neste processo. O Diário é consultado só pelo número, ${quando}.`,
    entrada.ultimaConsultaDjen
      ? `Consultado no Diário pelo número em ${diaCurto(entrada.ultimaConsultaDjen, entrada.agora)}.`
      : 'Ainda não consultado pelo número.',
  ];
  if (!entrada.djenHistoricoLidoEm) {
    /*
      O BOTÃO CERTO (15/09/2026). A frase mandava para "Sincronizar", que na
      ficha é o botão do DataJud; o que lê o Diário é "Buscar no DJEN", na aba
      Publicações — onde esta linha aparece.
    */
    linhas.push(
      'O histórico deste processo no Diário ainda não foi lido. Ele entra numa das próximas noites, ' +
        'ou agora pelo botão Buscar no DJEN, na aba Publicações.',
    );
  }

  return { porOab, ultimaConsultaNumero, historicoLidoEm, frequenciaDoNumero, linhas };
}
