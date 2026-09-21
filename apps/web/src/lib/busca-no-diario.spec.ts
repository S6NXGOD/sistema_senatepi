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
describe('o painel usa a função, e não uma frase própria', () => {
  const PAGINA = readFileSync(
    join(__dirname, '../app/(dashboard)/dashboard/page.tsx'),
    'utf8',
  );

  it('o resultado da busca vem de `resultadoDaVarredura`', () => {
    expect(PAGINA).toContain('const { tom, texto } = resultadoDaVarredura(r);');
  });

  /** O tom decide a cor do aviso: erro não pode sair em verde. */
  it('o tom escolhe entre erro, aviso e sucesso', () => {
    expect(PAGINA).toContain("if (tom === 'erro') toast.error(texto);");
    expect(PAGINA).toContain("else if (tom === 'aviso') toast.warning(texto);");
  });

  /** A frase antiga não pode voltar por um atalho. */
  it('o painel não escreve mais a frase de sucesso à mão', () => {
    expect(PAGINA).not.toContain("'Busca concluída — nada novo no Diário.'");
  });
});
