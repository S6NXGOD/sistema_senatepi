import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * "ESTA PARTE É UM FILIADO NOSSO?"
 *
 * O sindicato só litiga por si mesmo ou por um filiado — não existe terceira
 * hipótese. Ainda assim, 26 processos individuais da produção têm no polo ativo
 * uma pessoa SEM cadastro vinculado, e o motivo é sempre o mesmo: quem lançou
 * digitou o nome como texto livre (ou criou uma "parte externa") em vez de
 * procurar o filiado, e ninguém percebeu.
 *
 * POR QUE A BUSCA NORMAL NÃO RESOLVE. Ela exige TODOS os termos digitados
 * (`AND`), que é o certo para quem procura — mas aqui o nome que temos é o que
 * está nos autos, e ele quase nunca bate com o do cadastro:
 *
 *     autos:    SARA MACHADO MIRANDA LEAL BARBOSA
 *     cadastro: SARA MACHADO MIRANDA              -> a busca devolve ZERO
 *     autos:    MARCOS VICTOR
 *     cadastro: MARCOS VICTOR BARROS SILVA        -> a busca devolve ZERO
 *
 * Nos dois casos é a mesma pessoa, e o nome de um é SUBCONJUNTO do outro. É
 * essa a regra: **subconjunto nos dois sentidos, com o primeiro nome igual.**
 * Medida contra os 26 casos reais, ela encontra candidato em 14 — a busca atual
 * encontra em nenhum.
 *
 * O QUE ELA NÃO FAZ, DE PROPÓSITO: vincular sozinha. Nome de brasileiro
 * repete — "ANGELA MARIA" casa com quatro filiadas distintas — e um vínculo
 * errado junta o processo de uma pessoa à ficha de outra. Isso não é um bug de
 * listagem, é incidente de privacidade. A decisão é sempre de quem lê a tela;
 * o serviço ordena os candidatos e diz o grau de confiança de cada um.
 *
 * O CPF é a exceção: ele identifica. Quando o documento da parte bate com o de
 * um filiado, não há o que decidir — é CERTEZA, e a interface pode dizer isso.
 */

/** Partículas que não distinguem ninguém e atrapalham a comparação. */
const LIGACOES = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU']);

export type Confianca = 'CERTEZA' | 'PROVAVEL' | 'POSSIVEL';

export interface CandidatoFiliado {
  id: string;
  nome: string;
  cpfMascarado: string | null;
  situacao: string;
  confianca: Confianca;
  motivo: string;
}

/**
 * O nome reduzido ao que identifica: sem acento, sem pontuação, sem partículas
 * e sem iniciais soltas ("M." em "LIZZIANE TÁTILA M. SOARES" não prova nada).
 */
export function tokensDoNome(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !LIGACOES.has(t));
}

const contido = (a: string[], b: string[]) => a.length > 0 && a.every((t) => b.includes(t));

/**
 * Um nome é o mesmo do outro se o primeiro nome coincide e um deles é
 * subconjunto do outro. Exige DOIS tokens em comum no mínimo: só o primeiro
 * nome ("GIRCÉLIA") não sustenta um vínculo, e é melhor não sugerir nada do que
 * sugerir a pessoa errada com ar de resposta.
 */
export function parecemAMesmaPessoa(a: string, b: string): boolean {
  const ta = tokensDoNome(a);
  const tb = tokensDoNome(b);
  if (!ta.length || !tb.length || ta[0] !== tb[0]) return false;
  if (Math.min(ta.length, tb.length) < 2) return false;
  return contido(ta, tb) || contido(tb, ta);
}

const soDigitos = (v?: string | null) => (v ?? '').replace(/\D/g, '');

/** 000.***.**-00 — o bastante para conferir, sem expor o documento inteiro. */
export function mascararCpf(cpf?: string | null): string | null {
  const d = soDigitos(cpf);
  if (d.length !== 11) return null;
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
}

@Injectable()
export class SugestaoFiliadoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Candidatos a filiado para uma parte do processo. Vem ordenado: primeiro a
   * certeza do CPF, depois os nomes, e nunca mais de oito — lista longa não é
   * sugestão, é a busca de novo.
   */
  async paraParte(parteId: string): Promise<CandidatoFiliado[]> {
    const parte = await this.prisma.parteProcesso.findUnique({
      where: { id: parteId },
      select: { nome: true, documento: true, filiadoId: true },
    });
    if (!parte || parte.filiadoId) return [];
    return this.paraNome(parte.nome, parte.documento);
  }

  /**
   * A MESMA REGRA, PARA UMA LISTA INTEIRA — e numa consulta só.
   *
   * A fila tem 25 pessoas. Chamar `paraNome` para cada uma são 25 idas ao
   * banco em série: medido contra a produção, 5,8 segundos só nisso. Aqui os
   * primeiros nomes de todas viram um único `OR`, e o casamento acontece em
   * memória — o custo passa a ser de uma consulta, e a tela abre.
   */
  async paraVarios(
    alvos: { chave: string; nome: string; documento?: string | null }[],
  ): Promise<Map<string, CandidatoFiliado[]>> {
    const saida = new Map<string, CandidatoFiliado[]>();
    const uteis = alvos.filter((a) => tokensDoNome(a.nome).length >= 2);
    if (!uteis.length) return saida;

    const primeiros = [...new Set(uteis.map((a) => tokensDoNome(a.nome)[0].toLowerCase()))];
    const docs = uteis
      .map((a) => soDigitos(a.documento))
      .filter((d) => d.length === 11);

    const universo = await this.prisma.filiado.findMany({
      where: {
        OR: [
          ...primeiros.map((t) => ({ buscaNormalizada: { contains: t } })),
          ...(docs.length ? [{ cpf: { in: docs } }] : []),
        ],
      },
      select: { id: true, nomeCompleto: true, cpf: true, situacao: true },
      // Teto de segurança: um primeiro nome muito comum ("MARIA") pode trazer
      // centenas, e varrer 7 mil linhas em memória não é o negócio daqui.
      take: 2_000,
    });

    for (const alvo of uteis) {
      const doc = soDigitos(alvo.documento);
      const achados = new Map<string, CandidatoFiliado>();

      if (doc.length === 11) {
        for (const f of universo) {
          if (soDigitos(f.cpf) !== doc) continue;
          achados.set(f.id, this.candidato(f, 'CERTEZA', 'O CPF da parte é o mesmo deste cadastro.'));
        }
      }

      const iguais = universo.filter((f) => parecemAMesmaPessoa(alvo.nome, f.nomeCompleto));
      for (const f of iguais) {
        if (achados.has(f.id)) continue;
        achados.set(
          f.id,
          this.candidato(
            f,
            iguais.length === 1 ? 'PROVAVEL' : 'POSSIVEL',
            iguais.length === 1
              ? 'O nome do cadastro corresponde ao que consta nos autos.'
              : `Há ${iguais.length} cadastros com nome parecido — confira antes de vincular.`,
          ),
        );
      }
      saida.set(alvo.chave, this.ordenar([...achados.values()]));
    }
    return saida;
  }

  private candidato(
    f: { id: string; nomeCompleto: string; cpf: string | null; situacao: unknown },
    confianca: Confianca,
    motivo: string,
  ): CandidatoFiliado {
    return {
      id: f.id,
      nome: f.nomeCompleto,
      cpfMascarado: mascararCpf(f.cpf),
      situacao: String(f.situacao),
      confianca,
      motivo,
    };
  }

  private ordenar(lista: CandidatoFiliado[]): CandidatoFiliado[] {
    const ordem: Record<Confianca, number> = { CERTEZA: 0, PROVAVEL: 1, POSSIVEL: 2 };
    return lista
      .sort((a, b) => ordem[a.confianca] - ordem[b.confianca] || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, 8);
  }

  async paraNome(nome: string, documento?: string | null): Promise<CandidatoFiliado[]> {
    const doc = soDigitos(documento);
    const achados = new Map<string, CandidatoFiliado>();

    // 1) CPF: identifica. Não é sugestão, é resposta.
    if (doc.length === 11) {
      const porCpf = await this.prisma.filiado.findMany({
        where: { cpf: { contains: doc.slice(-9) } },
        select: { id: true, nomeCompleto: true, cpf: true, situacao: true },
        take: 5,
      });
      for (const f of porCpf) {
        if (soDigitos(f.cpf) !== doc) continue;
        achados.set(f.id, {
          id: f.id,
          nome: f.nomeCompleto,
          cpfMascarado: mascararCpf(f.cpf),
          situacao: String(f.situacao),
          confianca: 'CERTEZA',
          motivo: 'O CPF da parte é o mesmo deste cadastro.',
        });
      }
    }

    // 2) Nome. Filtra no banco pelo primeiro nome para não varrer 7 mil linhas,
    //    e aplica a regra de subconjunto em memória.
    const tokens = tokensDoNome(nome);
    if (tokens.length >= 2) {
      const candidatos = await this.prisma.filiado.findMany({
        where: { buscaNormalizada: { contains: tokens[0].toLowerCase() } },
        select: { id: true, nomeCompleto: true, cpf: true, situacao: true },
        take: 200,
      });
      const iguais = candidatos.filter((f) => parecemAMesmaPessoa(nome, f.nomeCompleto));
      for (const f of iguais) {
        if (achados.has(f.id)) continue;
        achados.set(f.id, {
          id: f.id,
          nome: f.nomeCompleto,
          cpfMascarado: mascararCpf(f.cpf),
          situacao: String(f.situacao),
          // Um único nome parecido é provável; vários iguais viram "possível",
          // porque nome de brasileiro repete e a escolha passa a ser humana.
          confianca: iguais.length === 1 ? 'PROVAVEL' : 'POSSIVEL',
          motivo:
            iguais.length === 1
              ? 'O nome do cadastro corresponde ao que consta nos autos.'
              : `Há ${iguais.length} cadastros com nome parecido — confira antes de vincular.`,
        });
      }
    }

    return this.ordenar([...achados.values()]);
  }
}
