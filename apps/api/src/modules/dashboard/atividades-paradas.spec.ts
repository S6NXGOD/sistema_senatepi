import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAINEL = readFileSync(join(__dirname, 'dashboard.module.ts'), 'utf8');

/** Só a definição do filtro — do nome até o fechamento do objeto. */
const FILTRO = PAINEL.slice(
  PAINEL.indexOf('const paradaWhere: Prisma.CompromissoWhereInput = {'),
  PAINEL.indexOf('};', PAINEL.indexOf('const paradaWhere: Prisma.CompromissoWhereInput = {')),
);

/**
 * AS ATIVIDADES PARADAS — com nome, e só as que já deveriam ter andado.
 */
describe('atividades paradas no painel', () => {
  /**
   * A faixa dizia "1 atividade parada" e mandava para a agenda inteira. Para ela
   * abrir a atividade certa, a resposta precisa dizer QUAIS.
   */
  it('a resposta traz a lista, e não só a contagem', () => {
    expect(PAINEL).toContain('paradas: semMovimentacaoCount');
    expect(PAINEL).toContain("orderBy: { updatedAt: 'asc' },");
    expect(PAINEL).toContain('take: 10,');
  });

  /** Um filtro só: a lista e o número nunca discordam. */
  it('contagem e lista usam o MESMO filtro', () => {
    expect(PAINEL).toContain('this.prisma.compromisso.count({ where: paradaWhere })');
    expect(PAINEL).toContain('where: paradaWhere,');
    // A forma antiga, escrita dentro do count, saiu.
    expect(PAINEL).not.toContain('updatedAt: { lt: menos7dias } } })');
  });

  /**
   * "PARADA" SÓ DEPOIS QUE A DATA CHEGOU.
   *
   * Sem este corte, uma audiência de daqui a três semanas que ninguém tocou
   * contava como abandono — e o "Preparar audiência", que o robô cria dias
   * antes da pauta, é exatamente esse caso. Medido na produção antes do corte:
   * 1 parada, com a data já vencida; o corte não esconde nada do que existe.
   */
  it('só conta a atividade cuja data já chegou', () => {
    expect(FILTRO).toContain('inicio: { lte: agora },');
    expect(FILTRO).toContain('updatedAt: { lt: menos7dias },');
    expect(FILTRO).toContain('status: ABERTOS,');
    // O escopo do perfil continua valendo: o advogado vê as dele.
    expect(FILTRO).toContain('...meu,');
  });
});
