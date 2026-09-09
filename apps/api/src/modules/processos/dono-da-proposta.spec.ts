import { CorrelacaoService } from './correlacao.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * PARA QUEM VAI A PROPOSTA — testado EXECUTANDO, não lendo o fonte.
 *
 * A suíte irmã (`caixa-de-propostas.spec.ts`) confere a ordem dos degraus lendo
 * o arquivo. Isso prova que a linha existe, não que ela roteia certo — e foi
 * exatamente assim que o erro passou: o teste dizia "prefere quem o ato nomeia"
 * e ficou VERDE enquanto 614 das 1.424 publicações da produção iriam para o
 * colega errado.
 *
 * Aqui o serviço roda de verdade contra um mundo pequeno e explícito. O caso
 * central é o comum na produção: o ato intima os QUATRO advogados do processo,
 * e só um deles é o responsável.
 */

/** O mundo: quatro advogados nossos, todos com OAB, todos ativos. */
const ADVOGADOS = [
  { id: 'u-carlos', oab: '3778', oabUf: 'PI', ativo: true },
  { id: 'u-icaro', oab: '17660', oabUf: 'PI', ativo: true },
  { id: 'u-murilo', oab: '9226', oabUf: 'PI', ativo: true },
  { id: 'u-sherad', oab: '11301', oabUf: 'PI', ativo: true },
  { id: 'u-saiu', oab: '99999', oabUf: 'PI', ativo: false },
];

/** Como o DJEN devolve: a equipe inteira, em ordem que não significa nada. */
const ATO_CITA_A_EQUIPE = [
  { numeroOab: '17660', ufOab: 'PI' }, // Ícaro vem primeiro — por acaso
  { numeroOab: '9226', ufOab: 'PI' },
  { numeroOab: '3778', ufOab: 'PI' }, // Carlos, o responsável, é o terceiro
  { numeroOab: '11301', ufOab: 'PI' },
  { numeroOab: '77777', ufOab: 'PI' }, // advogado da parte contrária
];

function servicoCom(advogadosNoAto: unknown[]) {
  const prisma = {
    user: {
      findFirst: async ({ where }: any) =>
        ADVOGADOS.find((a) => a.id === where.id && (!where.ativo || a.ativo)) ?? null,
      findMany: async () => ADVOGADOS.filter((a) => a.ativo),
    },
    comunicacaoDjen: {
      findUnique: async () => ({ advogados: advogadosNoAto }),
    },
  } as unknown as PrismaService;
  return new CorrelacaoService(prisma);
}

const processo = (advogadoId: string | null) =>
  ({
    id: 'p-1',
    numeroCNJ: '0000814-61.2026.5.22.0002',
    advogadoId,
    filiadoId: null,
    responsavelId: advogadoId ?? 'u-carlos',
    nossoPolo: 'ATIVO' as const,
  });

const dono = (svc: CorrelacaoService, p: ReturnType<typeof processo>) =>
  (svc as unknown as {
    donoDaProposta: (p: unknown, id: string) => Promise<string | null>;
  }).donoDaProposta(p, 'c-1');

describe('para quem vai a proposta', () => {
  it('vai para o RESPONSÁVEL, mesmo quando o ato cita outro colega antes', async () => {
    const svc = servicoCom(ATO_CITA_A_EQUIPE);
    await expect(dono(svc, processo('u-carlos'))).resolves.toBe('u-carlos');
  });

  /**
   * A prova de que a regra não é "o primeiro da lista por acaso acertou": com o
   * MESMO ato, trocar só o responsável tem de trocar o dono.
   */
  it('o mesmo ato muda de dono quando o responsável do processo muda', async () => {
    const svc = servicoCom(ATO_CITA_A_EQUIPE);
    await expect(dono(svc, processo('u-murilo'))).resolves.toBe('u-murilo');
    await expect(dono(svc, processo('u-sherad'))).resolves.toBe('u-sherad');
  });

  /** Sem responsável ativo, a OAB citada volta a valer — melhor que nada. */
  it('cai para a OAB citada quando o processo não tem responsável', async () => {
    const svc = servicoCom(ATO_CITA_A_EQUIPE);
    await expect(dono(svc, processo(null))).resolves.toBe('u-icaro');
  });

  /** Responsável que saiu do sindicato não recebe: ninguém veria a proposta. */
  it('ignora responsável inativo e usa a OAB citada', async () => {
    const svc = servicoCom(ATO_CITA_A_EQUIPE);
    await expect(dono(svc, processo('u-saiu'))).resolves.toBe('u-icaro');
  });

  /** Órfã é resposta legítima — a fila comum de quem coordena a mostra. */
  it('devolve null quando não há responsável nem advogado nosso citado', async () => {
    const svc = servicoCom([{ numeroOab: '77777', ufOab: 'PI' }]);
    await expect(dono(svc, processo(null))).resolves.toBeNull();
  });

  it('devolve null quando o ato não cita advogado nenhum', async () => {
    const svc = servicoCom([]);
    await expect(dono(svc, processo(null))).resolves.toBeNull();
  });

  /**
   * A INCONSISTÊNCIA QUE MOTIVOU A CORREÇÃO.
   *
   * O caminho que cria ATIVIDADE direto sempre usou `processo.advogadoId`. Só a
   * proposta usava a OAB citada — então a MESMA publicação caía com pessoas
   * diferentes conforme mencionasse prazo ou não. Um dono por caso, não dois.
   */
  it('a proposta cai com a mesma pessoa que receberia a atividade direta', async () => {
    const svc = servicoCom(ATO_CITA_A_EQUIPE);
    const p = processo('u-carlos');
    const daProposta = await dono(svc, p);
    const daAtividadeDireta = await (svc as unknown as {
      responsavel: (id: string | null) => Promise<string | null>;
    }).responsavel(p.advogadoId);
    expect(daProposta).toBe(daAtividadeDireta);
  });
});
