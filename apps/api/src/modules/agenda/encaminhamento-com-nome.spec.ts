import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESFECHOS_POR_TIPO, DESFECHOS_PADRAO, acharDesfecho } from './desfechos.catalogo';

/**
 * "ÀS VEZES UMA REUNIÃO É CONCLUÍDA COM ENCAMINHAMENTO, AÍ É CRIADO UMA
 * ATIVIDADE. ESSA ATIVIDADE REALMENTE É NECESSÁRIA?" — o dono, 21/09/2026.
 *
 * É. Uma deliberação que não vira tarefa com dono e data é uma deliberação que
 * ninguém executa — e é por isso que o seguimento da reunião é obrigatório.
 *
 * O QUE NÃO SERVIA ERA O TÍTULO. Varrendo as atividades atrasadas da produção
 * no mesmo dia: das CINCO, duas eram "Encaminhamento da reunião", do mesmo
 * advogado, as duas com o título padrão intacto e a data padrão de +7 dias.
 * "Encaminhamento da reunião" não diz o que fazer — quem abre a agenda uma
 * semana depois teria de reabrir a ata para descobrir. Aceitar o padrão era o
 * caminho mais curto, e o caminho mais curto é o que se percorre.
 */
describe('o seguimento da reunião pede um título de verdade', () => {
  const reuniao = acharDesfecho('REUNIAO', 'REUNIAO_COM_ENCAMINHAMENTOS');

  it('continua obrigatório: deliberação sem tarefa é deliberação perdida', () => {
    expect(reuniao?.seguimento?.obrigatorio).toBe(true);
  });

  it('mas o título padrão passou a ser só um exemplo', () => {
    expect(reuniao?.seguimento?.pedeTituloProprio).toBe(true);
    expect(reuniao?.seguimento?.exemplo).toBeTruthy();
  });

  /** O `titulo` fica: é o que a API grava se a rota for chamada sem nada. */
  it('o título padrão continua existindo como rede da API', () => {
    expect(reuniao?.seguimento?.titulo).toBe('Encaminhamento da reunião');
  });

  /**
   * SÓ ELE PEDE. Os outros títulos do catálogo já dizem o trabalho ("Cobrar
   * laudo pericial", "Conferir cumprimento do acordo") — marcar todos obrigaria
   * a redigitar o que já estava certo, e o atalho existe para isso.
   */
  it('os títulos que já dizem o trabalho não pedem nada', () => {
    const pedem = [...Object.values(DESFECHOS_POR_TIPO), DESFECHOS_PADRAO]
      .flat()
      .filter((d) => d.seguimento?.pedeTituloProprio)
      .map((d) => d.slug);
    expect(pedem).toEqual(['REUNIAO_COM_ENCAMINHAMENTOS']);
  });
});

/**
 * E A TELA ABRE O CAMPO VAZIO — sem isto, a marca no catálogo não muda nada.
 */
describe('a tela respeita a marca', () => {
  const MODAL = readFileSync(
    join(__dirname, '../../../../web/src/components/agenda/concluir-modal.tsx'),
    'utf8',
  );

  it('o título não é pré-preenchido quando o catálogo pede o próprio', () => {
    expect(MODAL).toContain("setSegTitulo(spec.pedeTituloProprio ? '' : spec.titulo);");
  });

  it('e o exemplo vira o placeholder', () => {
    expect(MODAL).toContain('spec.exemplo ? `Ex.: ${spec.exemplo}`');
  });

  /** A trava de salvar já exigia título não vazio — é ela que fecha a porta. */
  it('sem título não dá para concluir', () => {
    expect(MODAL).toContain('if (spec && criarSeg && (!segTitulo.trim() || !segData)) return false;');
  });
});
