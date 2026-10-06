import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resultadoDaVarredura } from './djen';

/**
 * "AQUI DEU 'BUSCA CONCLUÍDA E NADA NOVO NO DIÁRIO' MAS A BARRA AMARELA
 * PERSISTE. REALMENTE A BUSCA FOI UM SUCESSO?" — o dono, 21/09/2026.
 *
 * Não foi. O log da produção daquele minuto, três vezes seguidas:
 *
 *     "Varredura sem resposta: as 165 consulta(s) falharam."
 *
 * A tela só olhava `ingeridas === 0` e dizia "nada novo" — a MESMA frase para
 * "o Diário não tinha nada" e para "o Diário não respondeu nada". São coisas
 * opostas: a primeira é boa notícia, a segunda é um buraco de informação que
 * ninguém percebe. E o verde do aviso contradizia a faixa amarela que continuava
 * na tela dois dedos acima — quando duas superfícies discordam, a equipe aprende
 * a não confiar em nenhuma.
 */
const r = (p: Partial<Parameters<typeof resultadoDaVarredura>[0]>) =>
  resultadoDaVarredura({
    ingeridas: 0, falhas: 0, advogadosConsultados: 0, processosConsultados: 0, ...p,
  });

describe('o que dizer depois de buscar no Diário', () => {
  it('nenhuma consulta respondeu: é ERRO, e a frase não diz "nada novo"', () => {
    const { tom, texto } = r({ falhas: 165 });
    expect(tom).toBe('erro');
    expect(texto).toContain('165');
    expect(texto).not.toContain('nada novo');
  });

  it('tudo respondeu e não havia nada: é sucesso, e diz quantas responderam', () => {
    const { tom, texto } = r({ advogadosConsultados: 9, processosConsultados: 150 });
    expect(tom).toBe('ok');
    expect(texto).toContain('159 consultas responderam');
    expect(texto).toContain('nada novo');
  });

  it('achou publicação: é sucesso e diz quantas', () => {
    const { tom, texto } = r({ ingeridas: 4, advogadosConsultados: 9 });
    expect(tom).toBe('ok');
    expect(texto).toContain('4 publicação');
  });

  /**
   * FALHA PARCIAL NÃO É SUCESSO NEM ERRO: respondeu alguma coisa, mas o silêncio
   * do resto não pode ser lido como "não havia nada". Foi o caso de 20/09/2026 —
   * 159 de 165 em falha, e a rodada entrou no log como bem-sucedida.
   */
  it('a maioria falhou: avisa, e diz que pode ter ficado publicação para trás', () => {
    const { tom, texto } = r({ falhas: 159, advogadosConsultados: 6 });
    expect(tom).toBe('aviso');
    expect(texto).toContain('159 de 165');
    expect(texto).toContain('não chegou');
  });

  it('achou algumas E falhou outras: conta as duas coisas', () => {
    const { texto } = r({ ingeridas: 2, falhas: 3, advogadosConsultados: 9 });
    expect(texto).toContain('2 publicação');
    expect(texto).toContain('3 de 12');
  });

  /** Sem OAB no cadastro não há o que consultar — e isso não é "nada novo". */
  it('nada a consultar avisa, não comemora', () => {
    const { tom, texto } = r({});
    expect(tom).toBe('aviso');
    expect(texto).toContain('OAB');
  });
});

/**
 * E A TELA TEM DE USAR A FUNÇÃO — sem isto, os testes acima passam com o texto
 * velho no ar, que foi exatamente o que aconteceu: a função nasceu certa, a
 * ligação se perdeu num script que falhou no meio, os seis testes ficaram
 * verdes e o aviso na tela continuou dizendo "nada novo no Diário". Quem pegou
 * foi a conferência no navegador.
 */
/**
 * O PAINEL DEIXOU DE ANUNCIAR O RESULTADO — porque não o recebe mais.
 *
 * Até 06/10/2026 a rota devolvia os números da rodada e o painel os traduzia
 * aqui. Só que a rodada leva de 12 a 15 minutos (192 consultas a 14 por
 * minuto) e o cliente abortava aos 10, mostrando "Não foi possível buscar no
 * Diário agora" numa busca que tinha dado certo.
 *
 * Agora a API começa e responde na hora, e o resultado chega pela FAIXA, que
 * lê a linha de resumo da rodada — a mesma que distingue "o Diário não tinha
 * nada" de "o Diário não respondeu nada", que era a razão de esta função
 * existir. Ela fica exportada e testada acima: a conta continua certa e volta
 * a servir no dia em que uma tela mostrar o desfecho da rodada.
 */
describe('o clique só promete o que pode cumprir', () => {
  const PAGINA = readFileSync(
    join(__dirname, '../app/(dashboard)/dashboard/page.tsx'),
    'utf8',
  );

  it('avisa que começou e quanto demora, sem inventar contagem', () => {
    expect(PAGINA).toContain('Busca iniciada no Diário — leva cerca de ${r.minutosEstimados} minutos.');
    expect(PAGINA).toContain('Esta tela se atualiza quando terminar');
  });

  /** E não finge mais saber o desfecho na hora do clique. */
  it('o painel não traduz mais o resultado da rodada', () => {
    expect(PAGINA).not.toContain('const { tom, texto } = resultadoDaVarredura(r);');
  });

  /** A frase antiga não pode voltar por um atalho. */
  it('o painel não escreve a frase de sucesso à mão', () => {
    expect(PAGINA).not.toContain("'Busca concluída — nada novo no Diário.'");
  });
});
