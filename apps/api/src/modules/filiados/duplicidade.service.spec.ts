import { DuplicidadeService } from './duplicidade.service';

/**
 * Testes do JULGAMENTO — a parte que decide o que recomendar apagar.
 *
 * A varredura em si é SQL e se verifica contra o banco; o que precisa de teste
 * fechado é a regra que classifica confiança e escolhe qual cadastro manter.
 * Um erro aqui não quebra nada visivelmente: só produz uma recomendação errada,
 * que alguém aprova no cansaço da centésima revisão.
 */
describe('DuplicidadeService — julgamento', () => {
  const service = new DuplicidadeService({} as never, {} as never);
  // Métodos privados: o comportamento é o contrato, e testá-lo pela varredura
  // exigiria um banco só para exercitar aritmética.
  const svc = service as unknown as {
    paraCandidato: (l: Record<string, unknown>) => Record<string, unknown>;
    contradicoes: (c: unknown[]) => { rotulo: string }[];
    classificar: (c: unknown[], x: unknown[]) => string;
    escolherMantido: (c: unknown[], x: unknown[]) => { sugeridoId: string | null; decidiu: boolean; motivo: string | null };
  };

  const linha = (over: Record<string, unknown> = {}) => ({
    chave: 'k', id: 'id-1', nome_completo: 'MARIA DA SILVA', matricula: 'M1',
    cpf: null, numero_coren: null, cidade: null, estado: null,
    telefone_principal: null, email: null, data_nascimento: null, endereco: null,
    situacao: 'ATIVO', data_filiacao: null, created_at: new Date('2020-01-01'),
    tem_foto: false, vinculos: 0, ...over,
  });

  const cand = (over: Record<string, unknown> = {}) => svc.paraCandidato(linha(over));

  describe('pontuação de completude', () => {
    it('cadastro vazio pontua zero', () => {
      expect(cand().pontuacao).toBe(0);
    });

    it('CPF e COREN pesam mais que telefone — são âncoras de identidade', () => {
      expect(cand({ cpf: '12345678901' }).pontuacao).toBe(3);
      expect(cand({ numero_coren: '123456' }).pontuacao).toBe(3);
      expect(cand({ telefone_principal: '86999998888' }).pontuacao).toBe(1);
    });

    it('soma os campos e conta cada local de trabalho', () => {
      expect(cand({ cpf: '1', cidade: 'Teresina', vinculos: 2 }).pontuacao).toBe(3 + 1 + 2);
    });

    it('string vazia não conta como preenchida', () => {
      expect(cand({ cpf: '', cidade: '' }).pontuacao).toBe(0);
    });
  });

  describe('contradições', () => {
    it('campo vazio de um lado NÃO contradiz — é o padrão do duplicado incompleto', () => {
      const c = [cand({ id: 'a', cpf: '111' }), cand({ id: 'b', cpf: null })];
      expect(svc.contradicoes(c)).toHaveLength(0);
    });

    it('valores diferentes com os dois lados preenchidos contradizem', () => {
      const c = [cand({ id: 'a', cpf: '111' }), cand({ id: 'b', cpf: '222' })];
      expect(svc.contradicoes(c).map((x) => x.rotulo)).toEqual(['CPF']);
    });

    it('cidade compara sem diferenciar caixa', () => {
      const c = [cand({ id: 'a', cidade: 'Teresina' }), cand({ id: 'b', cidade: 'TERESINA' })];
      expect(svc.contradicoes(c)).toHaveLength(0);
    });
  });

  describe('classificação de confiança', () => {
    it('ALTA: mesma cidade preenchida nos dois e nada se contradiz', () => {
      const c = [cand({ id: 'a', cidade: 'Teresina', cpf: '111' }), cand({ id: 'b', cidade: 'Teresina' })];
      expect(svc.classificar(c, svc.contradicoes(c))).toBe('ALTA');
    });

    it('MEDIA: nada se contradiz, mas falta cidade para corroborar', () => {
      const c = [cand({ id: 'a', cpf: '111' }), cand({ id: 'b' })];
      expect(svc.classificar(c, svc.contradicoes(c))).toBe('MEDIA');
    });

    it('BAIXA: qualquer contradição derruba, mesmo com cidade igual', () => {
      const c = [
        cand({ id: 'a', cidade: 'Teresina', cpf: '111' }),
        cand({ id: 'b', cidade: 'Teresina', cpf: '222' }),
      ];
      expect(svc.classificar(c, svc.contradicoes(c))).toBe('BAIXA');
    });
  });

  describe('escolha de qual manter', () => {
    it('escolhe o mais completo e explica o porquê', () => {
      const c = [cand({ id: 'vazio' }), cand({ id: 'cheio', cpf: '111', cidade: 'Teresina' })];
      const r = svc.escolherMantido(c, svc.contradicoes(c));
      expect(r.sugeridoId).toBe('cheio');
      expect(r.decidiu).toBe(true);
      expect(r.motivo).toContain('CPF');
    });

    it('EMPATE não vira recomendação — o sistema admite que não sabe', () => {
      // 261 grupos da produção caem aqui, 144 deles totalmente vazios dos dois
      // lados. Sortear um e apresentar como conselho seria pior que calar.
      const c = [cand({ id: 'a' }), cand({ id: 'b' })];
      const r = svc.escolherMantido(c, svc.contradicoes(c));
      expect(r.decidiu).toBe(false);
      expect(r.sugeridoId).toBeNull();
    });

    it('com contradição o sistema não opina — podem ser pessoas reais distintas', () => {
      const c = [
        cand({ id: 'a', cpf: '111', cidade: 'Teresina', telefone_principal: '86988887777' }),
        cand({ id: 'b', cpf: '222' }),
      ];
      const r = svc.escolherMantido(c, svc.contradicoes(c));
      expect(r.decidiu).toBe(false);
      expect(r.sugeridoId).toBeNull();
    });
  });
});
