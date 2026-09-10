import { Injectable, Logger } from '@nestjs/common';
import { OrigemDaLigacao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { tenant } from '../../tenant/tenant.config';
import { chaveDeEnte, chavesDoTexto, siglaDeUF } from './chave-de-ente.util';

/**
 * LIGAR O CADASTRO AO CATÁLOGO DE ENTES — e as DUAS perguntas diferentes que
 * isso responde, que é o ponto inteiro deste arquivo.
 *
 * FILIADO → MUNICÍPIO é geografia: onde a pessoa mora. Sai do texto de cidade.
 *
 * ORGANIZAÇÃO → ENTE é orçamento: quem responde pelo dinheiro dela. E aqui a
 * localização NÃO serve de prova. O Hospital Getúlio Vargas fica em Teresina e
 * quem paga a folha dele é o Estado do Piauí; a Secretaria de Estado da Saúde
 * tem endereço em Teresina e não é da prefeitura. Ligar organização pelo
 * endereço colocaria o RGF de Teresina embaixo de dezenove enfermeiros que são
 * pagos pelo Estado — e o número apareceria com toda a cara de certo.
 *
 * Por isso a organização só se liga quando o NOME declara o ente. É pouco (21
 * das 77, medido) e é sólido; o resto fica para uma pessoa dizer.
 *
 * O QUE HÁ NA BASE (produção, 10/09/2026):
 *  · 7.321 filiados; 3.150 com cidade preenchida; só 546 com o estado;
 *  · 2.613 filiados têm cidade E NÃO têm estado;
 *  · sete grafias de Teresina; "TERSINA/CE", "Teresina/PL", "TERESINA/MA";
 *  · 77 organizações, das quais 18 nomeiam um município e 3 nomeiam o Estado
 *    ou a União.
 *
 * A ESCADA DE CONFIANÇA, e por que cada degrau existe:
 *
 *  1. NUNCA sobrescrever `MANUAL`. Se alguém abriu a ficha e escolheu, a
 *     varredura da madrugada não desfaz. É a mesma disciplina do log de
 *     auditoria: o que uma pessoa afirmou não se reescreve sozinho.
 *
 *  2. NOME_DE_ENTE — o nome inteiro declara o ente ("MUNICÍPIO DE CORRENTE",
 *     "ESTADO DO PIAUÍ"). É a única prova aceita para organização.
 *
 *  3. UF + NOME. Dentro de uma mesma UF não existe município repetido —
 *     conferido nos 5.571: ZERO colisões.
 *
 *  4. NOME_UNICO. São 240 nomes repetidos entre estados ("Bom Jesus" existe em
 *     cinco); os demais são únicos e cobrem 2.564 dos 2.613 filiados sem UF.
 *
 *  5. PREFERENCIA_UF — repetido, mas só um candidato na UF do sindicato. O
 *     degrau mais fraco, e por isso com nome próprio: é ele que a tela de
 *     conferência mostra primeiro.
 *
 *  6. O resto fica NULO. "Monte Alegre" (20 filiados) existe no Pará e no Rio
 *     Grande do Norte e NÃO existe no Piauí: nenhum palpite seria melhor que a
 *     pergunta a uma pessoa.
 */

/** O que uma passada de casamento produziu — números para a tela e para o log. */
export interface ResultadoVinculo {
  examinados: number;
  ligados: number;
  porOrigem: Record<string, number>;
  semResolver: number;
  /** Amostra do que não casou, para alguém olhar sem abrir o banco. */
  exemplosSemResolver: string[];
}

/**
 * Abreviações que aparecem no nome de ente público do cadastro e que o catálogo
 * do IBGE escreve por extenso. Lista curta e literal de propósito: cada entrada
 * saiu de um registro real ("MUN. DE CAP. DE CAMPOS" é Capitão de Campos).
 */
const ABREVIACOES: Record<string, string> = {
  cap: 'capitao',
  cel: 'coronel',
  dr: 'doutor',
  s: 'sao',
  sta: 'santa',
  sto: 'santo',
};

/**
 * O NOME QUE DECLARA UM ENTE MUNICIPAL — e a razão de a âncora ser o começo da
 * string, e não uma busca por dentro.
 *
 * Procurar nome de município DENTRO do texto acha coisas erradas com cara de
 * certas: "SOCIEDADE BRASILEIRA CAMINHO DE DAMASCO" contém "Brasileira", que é
 * um município do Piauí de verdade. Medido: a busca por substring "acertava" 27
 * das 77 organizações, e pelo menos duas eram falso positivo.
 */
const ENTE_MUNICIPAL =
  /^(?:municipio|mun|prefeitura(?:\s+municipal)?|camara(?:\s+municipal)?)\s+(?:de\s+|do\s+|da\s+|dos\s+|das\s+)?(.+)$/;

/**
 * O NOME QUE DECLARA UM ENTE ESTADUAL. Também ancorado no começo, e pelo mesmo
 * motivo — desta vez com um exemplo que quase me enganou na medição:
 * "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ"
 * contém "estado do piaui" e é o PRÓPRIO SINDICATO. Uma busca por substring o
 * classificaria como o Governo do Piauí.
 *
 * As duas formas que existem no cadastro: "ESTADO DO PIAUI" e "SECRETARIA DE
 * ESTADO DA SAÚDE DO PIAUÍ" — esta última nomeia o ente no FIM, por isso o
 * segundo padrão captura a cauda.
 */
const ENTE_ESTADUAL = /^(?:estado|governo(?:\s+do\s+estado)?)\s+(?:de\s+|do\s+|da\s+)?(.+)$/;
const SECRETARIA_ESTADUAL = /^secretaria\s+de\s+estado\s+.*?\s+(?:de|do|da)\s+([a-z\s]+)$/;
const ENTE_UNIAO = /^(?:uniao(?:\s+federal)?|governo\s+federal|advocacia\s+geral\s+da\s+uniao|agu)$/;

/** O código do SICONFI para a União — conferido: devolve "Governo Federal". */
const CODIGO_UNIAO = 1;

interface Candidato {
  codigo: number;
  uf: string;
  esfera: string;
}

/**
 * "TUDO QUE NÃO FOI DECIDIDO À MÃO" — e por que isto não é `{ not: MANUAL }`.
 *
 * Em SQL, `origem <> 'MANUAL'` NÃO é verdadeiro quando a coluna é NULA: é NULO,
 * e `WHERE nulo` não seleciona a linha. O Prisma traduz `{ not: X }` para
 * exatamente esse `<>`, então a forma ingênua exclui em silêncio justamente as
 * linhas que ninguém tocou — que são todas, no primeiro dia.
 *
 * MEDIDO NA PRODUÇÃO, com o defeito no ar (10/09/2026):
 *
 *   prisma.filiado.count({ where: { municipioOrigem: { not: 'MANUAL' } } })  ->  0
 *   select count(*) where (municipio_origem is null or <> 'MANUAL')          ->  3.150
 *
 * A varredura rodou, o log gravou sucesso, e ligou ZERO de 3.150. Não houve
 * erro em lugar nenhum — foi a consulta respondendo com honestidade a uma
 * pergunta que eu formulei errado.
 *
 * O teste que eu tinha escrito conferia o FORMATO do filtro contra um Prisma
 * falso: provou que a chamada acontece, não que ela seleciona. É o mesmo defeito
 * de método que já custou caro nesta base — teste que afirma a chamada.
 */
function NAO_E_MANUAL(campo: 'municipioOrigem' | 'enteOrigem') {
  return {
    OR: [{ [campo]: null }, { [campo]: { not: OrigemDaLigacao.MANUAL } }],
  } as Record<string, unknown>;
}

/**
 * "ESTA LINHA AINDA NÃO ESTÁ ASSIM" — a mesma armadilha, na forma composta.
 *
 * O objetivo é não gastar escrita no que já está certo: sem isso, a varredura
 * reescreveria 3.107 linhas toda noite para não mudar nada.
 *
 * A forma óbvia — `NOT: { municipioCodigo: X, municipioOrigem: Y }` — tem o
 * MESMO defeito da comparação simples, e pior escondido: com as duas colunas
 * nulas, `NOT (nulo = X AND nulo = Y)` é `NOT (desconhecido)`, que é
 * desconhecido, e a linha não entra. Medido na produção com a correção do
 * `NAO_E_MANUAL` já aplicada: 2.138 filiados em Teresina, e o `NOT` composto
 * derrubava para ZERO. Consertar só metade não consertou nada.
 *
 * Escrito como disjunção explícita, cada ramo responde sim ou não e o nulo entra
 * pela primeira porta: "não tem código" já basta para a linha precisar de
 * escrita.
 */
function AINDA_NAO_ESTA_ASSIM(codigo: number, origem: OrigemDaLigacao) {
  return {
    OR: [
      { municipioCodigo: null },
      { municipioCodigo: { not: codigo } },
      { municipioOrigem: null },
      { municipioOrigem: { not: origem } },
    ],
  } as Record<string, unknown>;
}

@Injectable()
export class VinculoDeEnteService {
  private readonly logger = new Logger(VinculoDeEnteService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A UF do sindicato — de onde sai a preferência do degrau 5. */
  private get ufDaCasa(): string {
    return (tenant.endereco?.uf ?? '').toUpperCase();
  }

  async indice(): Promise<Map<string, Candidato[]>> {
    const todos = await this.prisma.ente.findMany({
      select: { codigo: true, uf: true, esfera: true, nomeNormalizado: true },
    });
    const idx = new Map<string, Candidato[]>();
    for (const m of todos) {
      const lista = idx.get(m.nomeNormalizado) ?? [];
      lista.push({ codigo: m.codigo, uf: m.uf, esfera: m.esfera });
      idx.set(m.nomeNormalizado, lista);
    }
    return idx;
  }

  /**
   * O MUNICÍPIO DE UM TEXTO DE CIDADE — a decisão pura, sem banco, que os testes
   * exercitam. Só devolve município: pessoa não mora em Estado nem na União, e
   * há um CHECK no banco cobrando isso.
   */
  resolverMunicipio(
    idx: Map<string, Candidato[]>,
    entrada: { cidade?: string | null; uf?: string | null },
  ): { codigo: number; origem: OrigemDaLigacao } | null {
    const ufDaColuna = siglaDeUF(entrada.uf);

    /*
      AS LEITURAS DO TEXTO, em ordem: primeiro o que está escrito, depois a
      hipótese de que o fim é sigla de estado. A ordem salva **Sento Sé**, na
      Bahia, cujo nome oficial termina com a sigla de Sergipe — lido ao
      contrário, ele viraria "sento" e ninguém que mora lá teria município.
    */
    for (const { chave, ufSugerida } of chavesDoTexto(entrada.cidade)) {
      const candidatos = (idx.get(chave) ?? idx.get(this.semAbreviacoes(chave)) ?? []).filter(
        (c) => c.esfera === 'M',
      );
      if (!candidatos.length) continue;

      const uf = ufDaColuna ?? ufSugerida;
      if (uf) {
        const naUF = candidatos.find((c) => c.uf === uf);
        if (naUF) return { codigo: naUF.codigo, origem: OrigemDaLigacao.UF_E_NOME };
        /*
          A UF informada NÃO contém este município. Isto é "TERESINA/MA": um dos
          dois campos está errado e não dá para saber qual. Cair para o nome
          único aqui gravaria Teresina/PI por cima de uma informação que a
          contradiz — melhor tentar a próxima leitura e, se não houver, parar.
        */
        continue;
      }

      if (candidatos.length === 1) {
        return { codigo: candidatos[0].codigo, origem: OrigemDaLigacao.NOME_UNICO };
      }
      const daCasa = candidatos.filter((c) => c.uf === this.ufDaCasa);
      if (daCasa.length === 1) {
        return { codigo: daCasa[0].codigo, origem: OrigemDaLigacao.PREFERENCIA_UF };
      }
    }
    return null;
  }

  /**
   * O ENTE QUE UM NOME DE ORGANIZAÇÃO DECLARA — município, Estado ou União.
   *
   * Devolve `null` para tudo que não declare: hospital, clínica, cooperativa e
   * o próprio sindicato. É de propósito, e é o que impede o RGF errado de
   * aparecer embaixo de um cadastro (ver o cabeçalho do arquivo).
   */
  resolverPeloNome(
    idx: Map<string, Candidato[]>,
    nome: string | null | undefined,
  ): { codigo: number; origem: OrigemDaLigacao } | null {
    /* O que vem depois de " - " é órgão interno, não o ente: "MUNICIPIO DE
       LANDRI SALES - SECRETARIA DE SAUDE". */
    const chave = chaveDeEnte((nome ?? '').split(' - ')[0]);
    if (!chave) return null;

    if (ENTE_UNIAO.test(chave)) {
      return { codigo: CODIGO_UNIAO, origem: OrigemDaLigacao.NOME_DE_ENTE };
    }

    const estadual = ENTE_ESTADUAL.exec(chave) ?? SECRETARIA_ESTADUAL.exec(chave);
    if (estadual) {
      const alvo = chaveDeEnte(estadual[1]);
      const achado = (idx.get(alvo) ?? []).find((c) => c.esfera === 'E');
      if (achado) return { codigo: achado.codigo, origem: OrigemDaLigacao.NOME_DE_ENTE };
    }

    const municipal = ENTE_MUNICIPAL.exec(chave);
    if (municipal) {
      const bruto = municipal[1].trim();
      for (const leitura of chavesDoTexto(bruto)) {
        const candidatos = (
          idx.get(leitura.chave) ??
          idx.get(this.semAbreviacoes(leitura.chave)) ??
          []
        ).filter((c) => c.esfera === 'M');
        if (!candidatos.length) continue;
        const uf = leitura.ufSugerida ?? this.ufDaCasa;
        const naUF = candidatos.find((c) => c.uf === uf);
        if (naUF) return { codigo: naUF.codigo, origem: OrigemDaLigacao.NOME_DE_ENTE };
        if (candidatos.length === 1) {
          return { codigo: candidatos[0].codigo, origem: OrigemDaLigacao.NOME_DE_ENTE };
        }
      }
    }
    return null;
  }

  private semAbreviacoes(chave: string): string {
    return chave
      .split(' ')
      .map((p) => ABREVIACOES[p] ?? p)
      .join(' ');
  }

  // ------------------------------------------------------------------ passadas

  /**
   * FILIADOS — resolvido POR GRUPO, e não por pessoa.
   *
   * A decisão depende só do par (cidade, estado). São 3.150 filiados com cidade
   * preenchida e apenas 129 pares distintos: agrupar troca 3.150 `UPDATE`
   * individuais por 129 `updateMany`. Contra um banco remoto isso é a diferença
   * entre um botão que responde e um que dá timeout.
   */
  async casarFiliados(): Promise<ResultadoVinculo> {
    const idx = await this.indice();
    const grupos = await this.prisma.filiado.groupBy({
      by: ['cidade', 'estado'],
      where: { cidade: { not: null } },
      _count: { _all: true },
    });

    const r = this.zerado(grupos.reduce((a, g) => a + g._count._all, 0));
    const naoCasou: Array<[string, number]> = [];

    for (const g of grupos) {
      const escolha = this.resolverMunicipio(idx, { cidade: g.cidade, uf: g.estado });
      if (!escolha) {
        r.semResolver += g._count._all;
        naoCasou.push([`${g.cidade}${g.estado ? '/' + g.estado : ''}`, g._count._all]);
        continue;
      }
      const afetados = await this.prisma.filiado.updateMany({
        where: {
          cidade: g.cidade,
          estado: g.estado,
          /*
            AS DUAS CONDIÇÕES VÃO DENTRO DE `AND` porque as duas são um `OR`, e
            duas chaves `OR` no mesmo objeto não somam: a segunda sobrescreve a
            primeira, em silêncio.
          */
          AND: [
            // Nunca desfaz escolha de gente...
            NAO_E_MANUAL('municipioOrigem'),
            // ...e não gasta escrita no que já está certo.
            AINDA_NAO_ESTA_ASSIM(escolha.codigo, escolha.origem),
          ],
        },
        data: { municipioCodigo: escolha.codigo, municipioOrigem: escolha.origem },
      });
      r.ligados += afetados.count;
      r.porOrigem[escolha.origem] = (r.porOrigem[escolha.origem] ?? 0) + g._count._all;
    }

    r.exemplosSemResolver = this.amostra(naoCasou);
    this.logger.log(
      `[ENTES] Filiados: ${r.ligados} ligações gravadas, ${r.semResolver} sem resolver ` +
        `(${grupos.length} grafias distintas).`,
    );
    return r;
  }

  /**
   * ORGANIZAÇÕES — uma a uma, porque a decisão de cada uma vem do NOME, que é
   * único por registro. São 77; agrupar não economizaria nada.
   */
  async casarOrganizacoes(): Promise<ResultadoVinculo> {
    const idx = await this.indice();
    const alvos = await this.prisma.parteExterna.findMany({
      where: NAO_E_MANUAL('enteOrigem'),
      select: { id: true, nome: true, enteCodigo: true },
    });

    const r = this.zerado(alvos.length);
    const naoCasou: Array<[string, number]> = [];

    for (const o of alvos) {
      const escolha = this.resolverPeloNome(idx, o.nome);
      if (!escolha) {
        r.semResolver += 1;
        naoCasou.push([o.nome, 1]);
        continue;
      }
      r.porOrigem[escolha.origem] = (r.porOrigem[escolha.origem] ?? 0) + 1;
      if (o.enteCodigo === escolha.codigo) continue;
      await this.prisma.parteExterna.update({
        where: { id: o.id },
        data: { enteCodigo: escolha.codigo, enteOrigem: escolha.origem },
      });
      r.ligados += 1;
    }

    r.exemplosSemResolver = this.amostra(naoCasou);
    this.logger.log(
      `[ENTES] Organizações: ${r.ligados} ligações gravadas, ${r.semResolver} sem ente declarado no nome.`,
    );
    return r;
  }

  private zerado(examinados: number): ResultadoVinculo {
    return { examinados, ligados: 0, porOrigem: {}, semResolver: 0, exemplosSemResolver: [] };
  }

  private amostra(pares: Array<[string, number]>): string[] {
    return pares
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([texto, n]) => (n > 1 ? `${texto} (${n})` : texto));
  }
}
