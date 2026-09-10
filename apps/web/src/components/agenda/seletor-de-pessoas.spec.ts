import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SELETOR = readFileSync(join(__dirname, 'seletor-de-pessoas.tsx'), 'utf8');
const FORM = readFileSync(join(__dirname, 'compromisso-form-modal.tsx'), 'utf8');
const SERVICO = readFileSync(
  join(__dirname, '../../../../api/src/modules/agenda/agenda.service.ts'),
  'utf8',
);

/**
 * "QUERO A FOTINHA E MAIS DE UM RESPONSÁVEL."
 *
 * O que havia: um `<select>` de Responsável, sem foto, e ao lado uma caixa com
 * TODOS os dezesseis colaboradores como chips de texto — sem busca, sem avatar,
 * meia tela de nomes soltos. Dois controles para a mesma pergunta, e era
 * preciso entender que "Responsável" e "Também atuam" são listas diferentes da
 * mesma coisa.
 */
describe('um controle só, com rosto', () => {
  it('o formulário usa o seletor no lugar dos dois controles antigos', () => {
    expect(FORM).toContain('<SeletorDePessoas');
    // O `<select>` de responsável e a caixa de chips saíram.
    expect(FORM).not.toContain('value={responsavelId} onChange=');
    expect(FORM).not.toContain('Também atuam nesta atividade');
  });

  it('toda pessoa aparece com avatar', () => {
    expect(SELETOR).toContain('<AvatarPessoa nome={rotulo(p)} url={p.avatarUrl} tamanho="md" />');
    expect(SELETOR).toContain('<AvatarPessoa nome={rotulo(p)} url={p.avatarUrl} tamanho="sm" />');
  });

  /** Com dezesseis nomes, procurar batendo o olho não funciona. */
  it('há busca quando a lista é grande, e não quando é pequena', () => {
    expect(SELETOR).toContain('const MINIMO_PARA_BUSCA = 6;');
    expect(SELETOR).toContain('{pessoas.length > MINIMO_PARA_BUSCA && (');
  });

  /** "Sherad" tem de achar "Shérad" — buscar por nome não pode exigir acento. */
  it('a busca ignora acento', () => {
    expect(SELETOR).toContain("s.normalize('NFD')");
  });
});

/**
 * UM RESPONDE, VÁRIOS ATUAM — e a tela mentia sobre a segunda parte.
 *
 * O formulário dizia "Só ele conclui". Conferido no serviço: `concluir` NÃO
 * checa o responsável. Qualquer pessoa com permissão na agenda fecha, e quem
 * fechou fica gravado em `concluidoPor`. A frase saiu.
 */
describe('os dois papéis, ditos com honestidade', () => {
  it('o serviço realmente não restringe a conclusão ao responsável', () => {
    const i = SERVICO.indexOf('async concluir');
    expect(i).toBeGreaterThan(-1);
    const bloco = SERVICO.slice(i, i + 1800);
    // Nenhuma recusa por identidade — só por estado da atividade.
    expect(bloco).not.toContain('!== ctx.userId');
    expect(bloco).not.toContain('responsavelId !== ');
  });

  it('e a tela não afirma mais o contrário', () => {
    expect(FORM).not.toContain('Só ele conclui');
  });

  it('a explicação aparece só quando há mais de uma pessoa', () => {
    expect(SELETOR).toContain('{escolhidos.length > 1 && (');
    expect(SELETOR).toContain('podem concluí-la');
  });
});

/**
 * AS MECÂNICAS QUE POUPAM CLIQUE — e que precisam continuar poupando.
 */
describe('montar a dupla é um gesto, não um passeio', () => {
  it('a primeira pessoa escolhida vira responsável sozinha', () => {
    expect(SELETOR).toContain('if (!responsavelId) onResponsavel(id);');
  });

  it('promover alguém devolve o antigo responsável para a equipe', () => {
    expect(SELETOR).toContain('function tornarResponsavel(id: string)');
    expect(SELETOR).toContain('...(anterior && anterior !== id ? [anterior] : [])');
  });

  /**
   * Tirar quem responde não pode deixar a atividade órfã: cobrança precisa de
   * destinatário, e obrigar a reescolher seria um passo a mais.
   */
  it('remover o responsável promove o próximo da fila', () => {
    expect(SELETOR).toContain('const [proximo, ...resto] = participantes;');
    expect(SELETOR).toContain("onResponsavel(proximo ?? '');");
  });

  /** Alvos de 44px no telefone; 32px no desktop, onde há ponteiro. */
  it('os alvos de toque cabem no dedo', () => {
    expect(SELETOR).toContain('h-11 w-11 items-center justify-center rounded-md');
    expect(SELETOR).toContain('sm:h-8 sm:w-8');
  });
});
