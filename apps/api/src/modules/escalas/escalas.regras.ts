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
