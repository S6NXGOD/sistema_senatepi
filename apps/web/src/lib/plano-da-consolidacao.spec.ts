import { planejarConsolidacao, type CandidatoDuplicata } from './duplicidade';

/**
 * A CONFIRMAÇÃO TEM DE MOSTRAR A CONTA INTEIRA.
 *
 * O resumo da consolidação listava só o que seria COPIADO para o cadastro
 * mantido. O que o removido tinha de DIFERENTE sumia com ele e a tela chegava a
 * escrever "não tem nenhum dado que o mantido já não tenha" — verdade que
 * engana, porque o telefone, o endereço ou a cidade do outro cadastro iam
 * embora sem ninguém ver.
 *
 * E a filiação não é nem cópia nem perda: a mais antiga prevalece sempre. São
 * 91 pares só no lote de um clique em que o cadastro removido é o mais antigo —
 * média de 2.685 dias de sindicato que a fusão engolia.
 */
describe('planejarConsolidacao', () => {
  const base: CandidatoDuplicata = {
    id: 'a', nomeCompleto: 'MARIA DA SILVA', matricula: '5285', cpf: null,
    numeroCoren: null, cidade: null, estado: null, telefonePrincipal: null,
    email: null, dataNascimento: null, endereco: null, situacao: 'ATIVO',
    dataFiliacao: null, createdAt: '2023-06-14T03:00:00.000Z', temFoto: false,
    vinculos: 0, pontuacao: 0, sugerido: false,
  } as unknown as CandidatoDuplicata;

  const cand = (over: Partial<CandidatoDuplicata>): CandidatoDuplicata =>
    ({ ...base, ...over }) as CandidatoDuplicata;

  describe('o que será copiado', () => {
    it('campo que só o removido tem entra como cópia', () => {
      const plano = planejarConsolidacao(cand({}), [cand({ id: 'b', email: 'a@b.c' })]);
      expect(plano.absorvidos.map((x) => x.chave)).toEqual(['email']);
      expect(plano.perdidos).toEqual([]);
    });

    it('com vários removidos, o primeiro que tiver valor é a fonte', () => {
      const plano = planejarConsolidacao(cand({}), [
        cand({ id: 'b', matricula: 'B' }),
        cand({ id: 'c', matricula: 'C', cidade: 'Teresina' }),
      ]);
      expect(plano.absorvidos).toHaveLength(1);
      expect(plano.absorvidos[0].de.matricula).toBe('C');
    });
  });

  describe('o que será apagado', () => {
    it('valor divergente do removido é PERDA, e não some do resumo', () => {
      const plano = planejarConsolidacao(
        cand({ telefonePrincipal: '86999990000' }),
        [cand({ id: 'b', telefonePrincipal: '86988887777' })],
      );
      expect(plano.absorvidos).toEqual([]);
      expect(plano.perdidos).toHaveLength(1);
      expect(plano.perdidos[0].rotulo).toBe('Telefone');
      expect(plano.perdidos[0].de.id).toBe('b');
    });

    it('valor igual não é perda — nem com caixa e espaço diferentes', () => {
      const plano = planejarConsolidacao(
        cand({ cidade: 'Teresina' }),
        [cand({ id: 'b', cidade: '  teresina ' })],
      );
      expect(plano.perdidos).toEqual([]);
    });

    it('cada removido divergente aparece uma vez, com a matrícula dele', () => {
      const plano = planejarConsolidacao(cand({ cidade: 'Teresina' }), [
        cand({ id: 'b', matricula: 'B', cidade: 'Timon' }),
        cand({ id: 'c', matricula: 'C', cidade: 'Parnaíba' }),
      ]);
      expect(plano.perdidos.map((x) => x.de.matricula)).toEqual(['B', 'C']);
    });

    it('campo vazio de um lado nunca é perda — é o padrão do cadastro duplicado', () => {
      const plano = planejarConsolidacao(cand({ email: 'x@y.z' }), [cand({ id: 'b' })]);
      expect(plano.perdidos).toEqual([]);
    });
  });

  describe('a filiação mais antiga', () => {
    const dia = (iso: string) => `${iso}T03:00:00.000Z`; // meia-noite de Teresina, como chega no JSON

    it('aponta o removido quando ele é mais antigo que o mantido', () => {
      const plano = planejarConsolidacao(
        cand({ dataFiliacao: dia('2023-06-14') }),
        [cand({ id: 'b', dataFiliacao: dia('2011-04-15') })],
      );
      expect(plano.filiacaoPreservada?.id).toBe('b');
    });

    it('não aponta ninguém quando o mantido já é o mais antigo', () => {
      const plano = planejarConsolidacao(
        cand({ dataFiliacao: dia('2011-04-15') }),
        [cand({ id: 'b', dataFiliacao: dia('2023-06-14') })],
      );
      expect(plano.filiacaoPreservada).toBeNull();
    });

    it('aponta o removido quando o mantido não tem data nenhuma', () => {
      const plano = planejarConsolidacao(cand({}), [cand({ id: 'b', dataFiliacao: dia('2013-04-16') })]);
      expect(plano.filiacaoPreservada?.id).toBe('b');
    });

    it('entre vários removidos, escolhe o MAIS antigo', () => {
      const plano = planejarConsolidacao(cand({ dataFiliacao: dia('2023-06-14') }), [
        cand({ id: 'b', dataFiliacao: dia('2015-01-01') }),
        cand({ id: 'c', dataFiliacao: dia('2010-03-10') }),
        cand({ id: 'd', dataFiliacao: dia('2018-07-07') }),
      ]);
      expect(plano.filiacaoPreservada?.id).toBe('c');
    });

    it('datas iguais não geram anúncio de preservação', () => {
      const plano = planejarConsolidacao(
        cand({ dataFiliacao: dia('2020-01-10') }),
        [cand({ id: 'b', dataFiliacao: dia('2020-01-10') })],
      );
      expect(plano.filiacaoPreservada).toBeNull();
    });

    /**
     * A filiação tem regra própria e não pode aparecer como perda: ela nunca é
     * perdida. Se entrasse nas duas listas, a mesma linha diria "será apagado"
     * e "é preservada" ao mesmo tempo.
     */
    it('filiação nunca entra em perdidos nem em absorvidos', () => {
      const plano = planejarConsolidacao(
        cand({ dataFiliacao: dia('2023-06-14') }),
        [cand({ id: 'b', dataFiliacao: dia('2011-04-15') })],
      );
      expect(plano.perdidos.map((x) => x.chave)).not.toContain('dataFiliacao');
      expect(plano.absorvidos.map((x) => x.chave)).not.toContain('dataFiliacao');
    });
  });
});
