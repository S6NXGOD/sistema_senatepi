/**
 * AS REGRAS DA ESCALA, SEM BANCO — para que criar e editar leiam a mesma.
 *
 * Até 13/09/2026 o módulo gravava qualquer coisa: `createMany` sem conferir
 * duplicata nem sobreposição, e nenhuma rota de edição. Uma escala cadastrada
 * duas vezes aparecia dobrada no calendário, no cartão do painel (que contava
 * 2) e nos chips da triagem. A produção tinha 25 plantões, 5 advogados, cada um
 * num dia fixo, 09:00–12:00, e nenhuma sobreposição: travar agora é prevenção,
 * não limpeza.
 *
 * Criar e editar são dois caminhos que decidem a mesma coisa ("esta pessoa já
 * está de plantão nesta hora?"). Duas cópias da regra divergiriam em silêncio,
 * então ela mora aqui, testada com valores.
 */

/** "HH:MM" — o formato que a coluna guarda. Compara bem como texto. */
export interface Faixa {
  horaInicio: string;
  horaFim: string;
}

/** Um plantão pedido (lote do POST ou o resultado de um PATCH). */
export interface PlantaoPedido extends Faixa {
  /** Dia de calendário "YYYY-MM-DD". */
  data: string;
}

/** Um plantão que já está no banco, com a data já recortada em "YYYY-MM-DD". */
export interface PlantaoGravado extends PlantaoPedido {
  id: string;
}

export type Sobreposicao =
  | { tipo: 'EXISTENTE'; data: string; pedido: Faixa; existente: Faixa }
  | { tipo: 'NO_PEDIDO'; data: string; primeiro: Faixa; segundo: Faixa };

/**
 * Duas faixas se sobrepõem quando uma começa antes de a outra acabar.
 *
 * Encostar não é sobrepor: 09:00–12:00 e 12:00–15:00 são dois turnos seguidos,
 * e o plantão em dois turnos (manhã e tarde) é legítimo. "HH:MM" com zero à
 * esquerda ordena como texto, então não há conta de minutos.
 */
export function seSobrepoem(a: Faixa, b: Faixa): boolean {
  return a.horaInicio < b.horaFim && b.horaInicio < a.horaFim;
}

/**
 * "YYYY-MM-DD" que existe no calendário.
 *
 * A regex do DTO deixa passar 2026-02-31. `new Date('2026-02-31T00:00:00Z')`
 * não quebra: vira 03/03, e a escala entraria num dia que ninguém pediu.
 */
export function ehDataPuraValida(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === texto;
}

/**
 * O valor que a coluna `@db.Date` guarda: meia-noite UTC do próprio dia.
 *
 * Não é `instanteDoTextoBR`: aquela devolve 03:00 UTC (o instante em que o dia
 * começa em Teresina), e o Postgres, ao truncar para `date`, guardaria o dia
 * certo por sorte hoje e o errado no dia em que alguém mudar o tipo da coluna.
 */
export function dataDaColuna(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}

/** O dia de uma coluna `@db.Date` como texto — recorte, sem fuso (data pura). */
export function textoDaColuna(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "2026-09-15" → "15/09". A frase de erro fala do dia, e o ano é o de sempre. */
export function diaCurto(texto: string): string {
  const [, mes, dia] = texto.split('-');
  return `${dia}/${mes}`;
}

/**
 * Como a casa chama a pessoa, com o artigo quando o tratamento o denuncia.
 *
 * `nomeExibicao` já traz o tratamento ("Dra. Shérad"). "Em 15/09 a Dra. Shérad"
 * lê como gente; sem tratamento não há como saber o artigo, e chutar o gênero
 * de alguém numa mensagem é pior do que omitir o artigo.
 */
export function pessoaNaFrase(p: { nome: string; nomeExibicao?: string | null }): string {
  const nome = p.nomeExibicao?.trim() || p.nome;
  if (/^dra\.?\s/i.test(nome)) return `a ${nome}`;
  if (/^dr\.?\s/i.test(nome)) return `o ${nome}`;
  return nome;
}

/** Para começo de frase: "A Dra. Shérad", "O Dr. Murilo", "Ana Souza". */
export function pessoaNoInicio(p: { nome: string; nomeExibicao?: string | null }): string {
  const s = pessoaNaFrase(p);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const faixaTexto = (f: Faixa) => `${f.horaInicio}–${f.horaFim}`;

/**
 * A PRIMEIRA SOBREPOSIÇÃO de um pedido — dentro dele e contra o que já existe.
 *
 * DENTRO DO PEDIDO também, porque o modal permite repetir a data da linha
 * anterior (era o comportamento de "Adicionar data" até esta rodada): um lote
 * com 15/09 duas vezes passava na checagem contra o banco, que ainda não tinha
 * nenhuma das duas.
 *
 * `ignorarId` é a linha que está sendo editada: mudar 09:00–12:00 para
 * 09:00–11:00 não pode colidir consigo mesma.
 */
export function procurarSobreposicao(
  pedidos: PlantaoPedido[],
  existentes: PlantaoGravado[],
  ignorarId?: string,
): Sobreposicao | null {
  for (let i = 0; i < pedidos.length; i++) {
    const p = pedidos[i];
    for (let j = 0; j < i; j++) {
      const q = pedidos[j];
      if (q.data === p.data && seSobrepoem(p, q)) {
        return { tipo: 'NO_PEDIDO', data: p.data, primeiro: q, segundo: p };
      }
    }
    const choque = existentes.find(
      (e) => e.id !== ignorarId && e.data === p.data && seSobrepoem(p, e),
    );
    if (choque) return { tipo: 'EXISTENTE', data: p.data, pedido: p, existente: choque };
  }
  return null;
}

/**
 * A frase da recusa, dizendo QUAL dia e QUAL horário colidiu.
 *
 * "Horário inválido" obrigaria quem cadastra vinte datas a procurar a errada
 * uma por uma.
 */
export function fraseDaSobreposicao(
  s: Sobreposicao,
  pessoa: { nome: string; nomeExibicao?: string | null },
): string {
  if (s.tipo === 'EXISTENTE') {
    return `Em ${diaCurto(s.data)} ${pessoaNaFrase(pessoa)} já está de plantão ${faixaTexto(s.existente)}.`;
  }
  return (
    `O pedido repete ${diaCurto(s.data)} em horários que se sobrepõem ` +
    `(${faixaTexto(s.primeiro)} e ${faixaTexto(s.segundo)}).`
  );
}

/** Fim depois do início — "09:00–09:00" e "12:00–09:00" não são plantão. */
export function faixaValida(f: Faixa): boolean {
  return f.horaFim > f.horaInicio;
}

/**
 * "da Dra. Shérad", "do Dr. Murilo", "de Ana Souza" — a mesma regra do artigo,
 * contraída com a preposição. "Passou de a Dra. Shérad" não é português.
 */
export function pessoaDepoisDeDe(p: { nome: string; nomeExibicao?: string | null }): string {
  const s = pessoaNaFrase(p);
  if (s.startsWith('a ')) return `da ${s.slice(2)}`;
  if (s.startsWith('o ')) return `do ${s.slice(2)}`;
  return `de ${s}`;
}

/** "1 plantão", "22 plantões". */
export function contar(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

// ---------------------------------------------------------------------------
// COPIAR A ESCALA DE UM MÊS PARA OUTRO (D15 da rodada 3, 14/09/2026)
// ---------------------------------------------------------------------------

/*
  POR QUE A REGRA MORA AQUI, E UMA VEZ SÓ.

  A prévia (GET /escalas/copia) e a gravação (POST /escalas/copia) decidem a
  mesma coisa: que plantão vai para que dia. Se o web recalculasse, ou se o
  POST tivesse a própria conta, a pessoa desmarcaria na tela um item que o
  servidor gravaria de outro jeito (lição "Prévia lê a mesma regra"). O POST
  roda ESTA função de novo, dentro da transação, e só grava o que ela ainda
  propõe.

  O QUE A PRODUÇÃO MOSTROU (13/09/2026): agosto teve 9 plantões e setembro 16,
  num padrão fixo por dia da semana (seg Margareth/Murilo, ter Tiago, qua
  Morgana, qui Shérad/Murilo), sempre 09:00–12:00. As 25 observações eram
  nulas — por isso a observação não é copiada.

  A REGRA: cada plantão vai para o mesmo dia da semana, na mesma ocorrência do
  mês (a 1ª segunda para a 1ª segunda). A ordinal pura abre buraco: setembro de
  2026 tem 5 terças e 5 quartas e só 4 quintas; outubro tem 5 quintas e 5
  sextas. Copiar setembro para outubro deixaria 29/10 e 30/10 sem ninguém —
  justamente os dias em que o painel diria "Ninguém de plantão hoje". Então a
  5ª ocorrência do destino repete a última da origem, e a nota diz isso.
*/

const NOMES_DOS_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "2026-10" → "outubro". */
export function nomeDoMes(mes: string): string {
  return NOMES_DOS_MESES[Number(mes.slice(5, 7)) - 1] ?? mes;
}

/** 0 = domingo … 6 = sábado, em data pura (sem fuso: é o dia do calendário). */
const DIAS_NO_SINGULAR = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_NO_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
/** Sábado e domingo são masculinos: "o último sábado", "5º domingo". */
const ehMasculino = (diaDaSemana: number) => diaDaSemana === 0 || diaDaSemana === 6;

/** O dia da semana de "AAAA-MM-DD" (0 = domingo). */
export function diaDaSemanaDoDia(texto: string): number {
  return dataDaColuna(texto).getUTCDay();
}

/** Qual ocorrência daquele dia da semana no mês: 07/09/2026 é a 1ª segunda; 29/09, a 5ª terça. */
export function ocorrenciaNoMes(texto: string): number {
  return Math.floor((Number(texto.slice(8, 10)) - 1) / 7) + 1;
}

/** O dia da N-ésima ocorrência de um dia da semana no mês — ou `null` se o mês não a tem. */
export function diaDaOcorrencia(mes: string, diaDaSemana: number, ocorrencia: number): string | null {
  const [ano, m] = mes.split('-').map(Number);
  const primeiroDoMes = new Date(Date.UTC(ano, m - 1, 1)).getUTCDay();
  const dia = 1 + ((diaDaSemana - primeiroDoMes + 7) % 7) + (ocorrencia - 1) * 7;
  const ultimoDoMes = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  if (dia > ultimoDoMes) return null;
  return `${mes}-${String(dia).padStart(2, '0')}`;
}

/** Quem está num plantão da cópia — `ativo` decide se ainda pode ser escalado. */
export interface PessoaDaCopia {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  ativo: boolean;
}

/** Um plantão gravado, com a pessoa (origem ou destino). */
export interface PlantaoDaCopia extends PlantaoGravado {
  advogadoId: string;
  advogado: PessoaDaCopia;
}

export type TipoDeNotaDaCopia = 'QUINTA_REPETIDA' | 'DIFERENTE_DO_RESTO' | 'DIA_JA_COBERTO';
export type MotivoDeFicarDeFora = 'SEM_OCORRENCIA' | 'JA_ESTA_DE_PLANTAO' | 'DIA_PASSOU' | 'PESSOA_INATIVA';

type PessoaNaResposta = Pick<PessoaDaCopia, 'id' | 'nome' | 'nomeExibicao'>;

export interface ItemDaCopia extends Faixa {
  origemId: string;
  /** Dia do destino. */
  data: string;
  origemData: string;
  advogado: PessoaNaResposta;
  /** O padrão da caixa na prévia. Dia já coberto por outra pessoa vem desmarcado. */
  marcado: boolean;
  nota: null | { tipo: TipoDeNotaDaCopia; texto: string };
}

export interface ItemForaDaCopia extends Faixa {
  origemId: string;
  origemData: string;
  advogado: PessoaNaResposta;
  motivo: MotivoDeFicarDeFora;
  /** Vem depois de "ter, 29/09 · Dr. Murilo — " na tela: começa em minúscula. */
  texto: string;
}

export interface PlanoDaCopia {
  criar: ItemDaCopia[];
  fora: ItemForaDaCopia[];
}

/** Um item da cópia é o par (plantão de origem, dia do destino): a 5ª ocorrência repete a origem. */
export const chaveDaCopia = (i: { origemId: string; data: string }) => `${i.origemId}|${i.data}`;

const nomeDaPessoa = (p: { nome: string; nomeExibicao?: string | null }) => p.nomeExibicao?.trim() || p.nome;

const porDiaEHora = (a: { data: string; horaInicio: string }, b: { data: string; horaInicio: string }) =>
  a.data.localeCompare(b.data) || a.horaInicio.localeCompare(b.horaInicio);

/**
 * "Nas outras terças de setembro foi a Dra. Shérad."
 *
 * DESVIO DO PADRÃO, sem corrigir. Uma troca registrada num dia da origem seria
 * copiada como se fosse regra. O sistema não sabe se é troca ou rodízio, então
 * mantém o que está na origem e só mostra.
 *
 * "Regular" é quem aparece em MAIS DA METADE dos dias daquele dia da semana e
 * faixa. Com dois advogados todo dia (segunda Margareth e Murilo), os dois são
 * regulares e ninguém ganha nota; com Tiago em 3 terças e Shérad em 1, a terça
 * da Shérad ganha a nota — se o Tiago não estava lá também.
 */
function notaDeDesvio(p: PlantaoDaCopia, daOrigem: PlantaoDaCopia[], origem: string): string | null {
  const dow = diaDaSemanaDoDia(p.data);
  const grupo = daOrigem.filter(
    (o) => diaDaSemanaDoDia(o.data) === dow && o.horaInicio === p.horaInicio && o.horaFim === p.horaFim,
  );
  const dias = new Set(grupo.map((o) => o.data));
  const diasPorPessoa = new Map<string, { pessoa: PessoaDaCopia; dias: Set<string> }>();
  for (const o of grupo) {
    const atual = diasPorPessoa.get(o.advogadoId) ?? { pessoa: o.advogado, dias: new Set<string>() };
    atual.dias.add(o.data);
    diasPorPessoa.set(o.advogadoId, atual);
  }
  const regulares = [...diasPorPessoa.entries()].filter(([, v]) => v.dias.size * 2 > dias.size);
  if (regulares.some(([id]) => id === p.advogadoId)) return null;
  const ausentes = regulares.filter(([, v]) => !v.dias.has(p.data)).map(([, v]) => v.pessoa);
  if (!ausentes.length) return null;
  const nomes = ausentes.map(pessoaNaFrase);
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  const outras = ehMasculino(dow) ? `Nos outros ${DIAS_NO_PLURAL[dow]}` : `Nas outras ${DIAS_NO_PLURAL[dow]}`;
  return `${outras} de ${nomeDoMes(origem)} ${nomes.length === 1 ? 'foi' : 'foram'} ${lista}`;
}

/**
 * O PLANO DA CÓPIA — o que vai ser criado e o que fica de fora, com os textos.
 *
 * Fica de fora, sem caixa (a ordem é a da pergunta que se faz primeiro):
 *  · o mês de destino não tem aquela ocorrência (5ª terça em outubro);
 *  · o dia já passou em Teresina (`hoje`) — copiar para o mês corrente cria
 *    de hoje em diante;
 *  · a pessoa foi desativada;
 *  · a mesma pessoa já tem plantão que se sobrepõe naquele dia. É o que torna
 *    repetir a cópia inofensivo: nada duplica.
 *
 * Entra DESMARCADO quando OUTRA pessoa já cobre o dia na mesma faixa. Não é
 * sobreposição pela regra (duas pessoas podem), mas quase sempre é mês já
 * preenchido à mão.
 *
 * A 5ª ocorrência do destino, quando a origem não a tem, recebe os plantões da
 * ÚLTIMA ocorrência COM PLANTÃO daquele dia na origem. "Com plantão" porque a
 * última quinta pode ter sido feriado; copiar o vazio dela deixaria o buraco
 * que a regra existe para fechar.
 *
 * Sábado e domingo: copia o que existir (foi decisão de gente) e não inventa.
 */
export function planejarCopia(p: {
  origem: string;
  destino: string;
  plantoesDaOrigem: PlantaoDaCopia[];
  plantoesDoDestino: PlantaoDaCopia[];
  /** "AAAA-MM-DD" de hoje em Teresina. */
  hoje: string;
}): PlanoDaCopia {
  const daOrigem = p.plantoesDaOrigem.filter((o) => o.data.startsWith(`${p.origem}-`)).sort(porDiaEHora);
  const doDestino = p.plantoesDoDestino.filter((o) => o.data.startsWith(`${p.destino}-`));

  type Candidato = { plantao: PlantaoDaCopia; data: string | null; quintaRepetida: string | null };
  const candidatos: Candidato[] = daOrigem.map((plantao) => ({
    plantao,
    data: diaDaOcorrencia(p.destino, diaDaSemanaDoDia(plantao.data), ocorrenciaNoMes(plantao.data)),
    quintaRepetida: null,
  }));

  for (let dow = 0; dow < 7; dow++) {
    const quintaDoDestino = diaDaOcorrencia(p.destino, dow, 5);
    if (!quintaDoDestino || diaDaOcorrencia(p.origem, dow, 5)) continue;
    const doDia = daOrigem.filter((o) => diaDaSemanaDoDia(o.data) === dow);
    if (!doDia.length) continue;
    const ultimaData = doDia[doDia.length - 1].data;
    const ultima = ehMasculino(dow) ? `o último ${DIAS_NO_SINGULAR[dow]}` : `a última ${DIAS_NO_SINGULAR[dow]}`;
    for (const plantao of doDia.filter((o) => o.data === ultimaData)) {
      candidatos.push({
        plantao,
        data: quintaDoDestino,
        quintaRepetida: `Repete ${ultima} de ${nomeDoMes(p.origem)} (${diaCurto(ultimaData)})`,
      });
    }
  }

  // Ordem do destino: é ela que decide, dentro do próprio plano, quem entra
  // primeiro quando dois itens da mesma pessoa caem no mesmo dia.
  candidatos.sort(
    (a, b) =>
      (a.data ?? a.plantao.data).localeCompare(b.data ?? b.plantao.data) ||
      a.plantao.horaInicio.localeCompare(b.plantao.horaInicio) ||
      a.plantao.data.localeCompare(b.plantao.data),
  );

  const criar: ItemDaCopia[] = [];
  const fora: ItemForaDaCopia[] = [];
  const aceitos: PlantaoDaCopia[] = [];

  for (const { plantao: o, data, quintaRepetida } of candidatos) {
    const base = {
      origemId: o.id,
      origemData: o.data,
      advogado: { id: o.advogado.id, nome: o.advogado.nome, nomeExibicao: o.advogado.nomeExibicao },
      horaInicio: o.horaInicio,
      horaFim: o.horaFim,
    };
    const dow = diaDaSemanaDoDia(o.data);

    if (!data) {
      const ordinal = ehMasculino(dow) ? '5º' : '5ª';
      fora.push({
        ...base,
        motivo: 'SEM_OCORRENCIA',
        texto: `${nomeDoMes(p.destino)} não tem ${ordinal} ${DIAS_NO_SINGULAR[dow]}`,
      });
      continue;
    }
    if (data < p.hoje) {
      fora.push({ ...base, motivo: 'DIA_PASSOU', texto: `${diaCurto(data)} já passou` });
      continue;
    }
    if (!o.advogado.ativo) {
      fora.push({ ...base, motivo: 'PESSOA_INATIVA', texto: `o cadastro ${pessoaDepoisDeDe(o.advogado)} está inativo` });
      continue;
    }
    const daMesmaPessoa = [...doDestino, ...aceitos].filter((e) => e.advogadoId === o.advogadoId);
    const choque = procurarSobreposicao([{ data, horaInicio: o.horaInicio, horaFim: o.horaFim }], daMesmaPessoa);
    if (choque && choque.tipo === 'EXISTENTE') {
      fora.push({
        ...base,
        motivo: 'JA_ESTA_DE_PLANTAO',
        texto: `já está de plantão em ${diaCurto(data)}, ${faixaTexto(choque.existente)}`,
      });
      continue;
    }

    const cobertoPor = doDestino.find(
      (e) => e.advogadoId !== o.advogadoId && e.data === data && seSobrepoem(e, o),
    );
    let nota: ItemDaCopia['nota'] = null;
    if (cobertoPor) {
      nota = {
        tipo: 'DIA_JA_COBERTO',
        texto: `O dia já tem ${pessoaNaFrase(cobertoPor.advogado)} das ${cobertoPor.horaInicio} às ${cobertoPor.horaFim}`,
      };
    } else if (quintaRepetida) {
      nota = { tipo: 'QUINTA_REPETIDA', texto: quintaRepetida };
    } else {
      const desvio = notaDeDesvio(o, daOrigem, p.origem);
      if (desvio) nota = { tipo: 'DIFERENTE_DO_RESTO', texto: desvio };
    }

    criar.push({ ...base, data, marcado: !cobertoPor, nota });
    aceitos.push({ ...o, id: chaveDaCopia({ origemId: o.id, data }), data });
  }

  criar.sort(
    (a, b) =>
      porDiaEHora(a, b) ||
      nomeDaPessoa(a.advogado).localeCompare(nomeDaPessoa(b.advogado), 'pt-BR'),
  );
  fora.sort((a, b) => a.origemData.localeCompare(b.origemData) || a.horaInicio.localeCompare(b.horaInicio));
  return { criar, fora };
}
