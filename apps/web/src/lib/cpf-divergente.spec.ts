import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  planejarConsolidacao, soDigitosDoCpf, veredictoDoCpf,
  type AnaliseDeCpf, type CandidatoDuplicata,
} from './duplicidade';

/**
 * UM DÍGITO TROCADO — o caso da LUANA, 18/09/2026.
 *
 * O dono abriu a fila e viu dois CPFs que diferem em um dígito:
 *
 *   4002 (que a tela mandava MANTER)   840.053.869-34
 *   5811 (que a tela ia APAGAR)        840.053.863-34
 *
 * e escreveu: *"sei que é um risco mas um tem o CPF errado e o outro certo."*
 *
 * Ele estava certo — e o sistema sabia qual era o errado e não dizia. Pior: o
 * CPF que ficaria era o do cadastro escolhido, que nesse caso é o INVÁLIDO.
 * Aceitar a consolidação cegamente gravaria o errado para sempre e destruiria
 * o certo.
 *
 * A análise vem PRONTA do servidor — a mesma função que decide se a fusão
 * passa. Aqui só se testa o que a tela diz e o que ela deixa fazer.
 */
const analise = (over: Partial<AnaliseDeCpf> = {}): AnaliseDeCpf => ({
  porCadastro: [
    { id: 'a', matricula: '4002', cpf: '840.053.869-34', valido: false },
    { id: 'b', matricula: '5811', cpf: '840.053.863-34', valido: true },
  ],
  umSoValido: true,
  todosValidos: false,
  cpfBom: '84005386334',
  ...over,
});

describe('o caso da LUANA', () => {
  const v = veredictoDoCpf(analise());

  it('a tela nomeia o CPF que passa na conta', () => {
    expect(v.titulo).toBe('Só 840.053.863-34 passa no dígito verificador.');
  });

  it('e avisa que o que fica pode vir do cadastro que sai', () => {
    expect(v.recado).toContain('840.053.869-34 não passa');
    expect(v.recado).toContain('matrícula 5811');
    expect(v.recado).toContain('mesmo que seja o do cadastro que sai');
  });

  it('libera a consolidação e já escolhe o válido — sem perguntar o óbvio', () => {
    expect(v.liberado).toBe(true);
    expect(v.escolhaPadrao).toBe('84005386334');
  });
});

/**
 * DOIS CPFs VÁLIDOS SÃO DUAS PESSOAS. Esta é a única situação em que nem a
 * confirmação libera — e a tela precisa oferecer a saída que existe, em vez de
 * só dizer não.
 */
describe('os dois válidos', () => {
  const v = veredictoDoCpf(
    analise({
      porCadastro: [
        { id: 'a', matricula: '4002', cpf: '840.053.863-34', valido: true },
        { id: 'b', matricula: '5811', cpf: '529.982.247-25', valido: true },
      ],
      umSoValido: false,
      todosValidos: true,
      cpfBom: null,
    }),
  );

  it('não libera', () => {
    expect(v.liberado).toBe(false);
    expect(v.escolhaPadrao).toBeNull();
  });

  it('e diz o caminho que existe, em vez de só recusar', () => {
    expect(v.recado).toContain('corrija o CPF errado na ficha');
  });
});

describe('nenhum válido', () => {
  const v = veredictoDoCpf(
    analise({
      porCadastro: [
        { id: 'a', matricula: '4002', cpf: '111.111.111-11', valido: false },
        { id: 'b', matricula: '5811', cpf: '123.456.789-00', valido: false },
      ],
      umSoValido: false,
      todosValidos: false,
      cpfBom: null,
    }),
  );

  it('libera, mas a escolha é de gente — o sistema não tem palpite', () => {
    expect(v.liberado).toBe(true);
    expect(v.escolhaPadrao).toBeNull();
    expect(v.recado).toContain('Escolha qual deve ficar');
  });
});

describe('dois inválidos e um válido', () => {
  it('a frase fica no plural para os que não passam', () => {
    const v = veredictoDoCpf(
      analise({
        porCadastro: [
          { id: 'a', matricula: '1', cpf: '840.053.869-34', valido: false },
          { id: 'b', matricula: '2', cpf: '840.053.860-34', valido: false },
          { id: 'c', matricula: '3', cpf: '840.053.863-34', valido: true },
        ],
      }),
    );
    expect(v.recado).toContain('não passam');
  });
});

describe('a comparação é por dígito, não por grafia', () => {
  it('pontuação some', () => {
    expect(soDigitosDoCpf('840.053.863-34')).toBe('84005386334');
    expect(soDigitosDoCpf('84005386334')).toBe('84005386334');
  });
});

/**
 * O DIÁLOGO NÃO PODE CONFIRMAR SOZINHO COM CPF EM CONFLITO.
 *
 * `confirmarComEnter` está ligado neste diálogo por decisão do dono, e é o que
 * torna a fila rápida. Com CPFs divergentes ele precisa ceder: `confirmDisabled`
 * trava o botão E o atalho (ver `confirm-dialog.tsx`), então o Enter não apaga
 * cadastro antes de alguém ler o veredito.
 */
describe('a trava na tela', () => {
  const PAGINA = readFileSync(
    path.join(__dirname, '../app/(dashboard)/filiados/duplicados/page.tsx'),
    'utf8',
  );

  it('a confirmação trava enquanto falta escolher, ou quando os dois são válidos', () => {
    expect(PAGINA).toContain(
      "const fusaoTravada = !!conflitoDeCpf && (!veredictoCpf?.liberado || !cpfQueFica);",
    );
    expect(PAGINA).toContain('confirmDisabled={fusaoTravada}');
  });

  it('a escolha do CPF é enviada ao servidor', () => {
    expect(PAGINA).toContain('cpfQueFica ?? undefined');
  });

  /** Escolha do grupo anterior não pode vazar para o próximo. */
  it('a escolha é reposta a cada abertura do diálogo', () => {
    expect(PAGINA).toContain('setCpfQueFica(veredictoCpf?.escolhaPadrao ?? null);');
  });
});

/**
 * A PRÉVIA NÃO PODE SE CONTRADIZER — visto na tela em 18/09/2026.
 *
 * O bloco do conflito dizia "fica o da matrícula 5811" e, três linhas abaixo, o
 * resumo de sempre dizia "SERÁ APAGADO: CPF 840.053.863-34" — o MESMO número,
 * no diálogo que apaga cadastro. `planejarConsolidacao` não sabia da escolha e
 * continuava assumindo que o CPF acompanha o cadastro mantido.
 */
describe('o plano da consolidação conhece o CPF escolhido', () => {
  const pessoa = (over: Partial<CandidatoDuplicata>): CandidatoDuplicata => ({
    id: 'x', nomeCompleto: 'LUANA', matricula: '0', cpf: null, numeroCoren: null,
    cidade: null, estado: null, telefonePrincipal: null, email: null, dataNascimento: null,
    endereco: null, situacao: 'ATIVO', dataFiliacao: null, createdAt: '2020-01-01',
    temFoto: false, vinculos: 0, pontuacao: 0, sugerido: false, ...over,
  });
  const manter = pessoa({ id: 'a', matricula: '4002', cpf: '84005386934' });
  const sai = pessoa({ id: 'b', matricula: '5811', cpf: '84005386334' });

  it('sem escolha, o CPF do removido consta como PERDIDO — o comportamento de sempre', () => {
    const p = planejarConsolidacao(manter, [sai]);
    expect(p.perdidos.map((x) => x.chave)).toContain('cpf');
    expect(p.absorvidos.map((x) => x.chave)).not.toContain('cpf');
  });

  it('escolhendo o do removido, ele vira ABSORVIDO e o outro é que se perde', () => {
    const p = planejarConsolidacao(manter, [sai], '84005386334');
    expect(p.absorvidos.find((x) => x.chave === 'cpf')?.de.matricula).toBe('5811');
    // E o número que fica NÃO aparece mais na lista do que será apagado.
    expect(p.perdidos.filter((x) => x.chave === 'cpf')).toHaveLength(0);
  });

  it('escolhendo o do mantido, nada é absorvido e o do removido se perde', () => {
    const p = planejarConsolidacao(manter, [sai], '84005386934');
    expect(p.absorvidos.filter((x) => x.chave === 'cpf')).toHaveLength(0);
    expect(p.perdidos.find((x) => x.chave === 'cpf')?.de.matricula).toBe('5811');
  });

  it('a escolha não mexe nos outros campos', () => {
    const comTelefone = pessoa({ id: 'b', matricula: '5811', cpf: '84005386334', telefonePrincipal: '86999990000' });
    const p = planejarConsolidacao(manter, [comTelefone], '84005386334');
    expect(p.absorvidos.map((x) => x.chave).sort()).toEqual(['cpf', 'telefonePrincipal']);
  });
});
