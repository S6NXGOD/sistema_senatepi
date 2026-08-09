import {
  BaseAtual,
  LinhaFolha,
  VinculoExistente,
  camposParaCompletar,
  classificarLinha,
  compararNomes,
  descontoNaFolha,
  diferencasDoVinculo,
  mapearColunas,
  normalizarLinha,
  normalizarMatricula,
  normalizarTexto,
  pareceFolhaPrefeitura,
  tokensNome,
} from './folha-prefeitura.util';

/**
 * Testes do JULGAMENTO da folha da Prefeitura.
 *
 * O que se verifica aqui não é aritmética: é a decisão "quem é esta pessoa?"
 * tomada 4.000 vezes seguidas, sem CPF para conferir. Um erro nesta regra não
 * aparece na tela — aparece meses depois, como um filiado com o cargo de outro
 * ou como duas fichas da mesma pessoa que ninguém sabe qual é a boa.
 *
 * Por isso os casos abaixo são os REAIS: zero à esquerda que o Excel come,
 * acento que a Prefeitura escreve de dois jeitos, homônimo, matrícula
 * reaproveitada e a coluna que veio vazia numa competência.
 */

const linha = (over: Partial<LinhaFolha> = {}): LinhaFolha => {
  const base = {
    orgao: 'SEMEC',
    matricula: '12345',
    nome: 'MARIA DA SILVA',
    quadro: 'EFETIVO',
    lotacao: 'ESCOLA MUNICIPAL X',
    cargo: 'PROFESSOR',
    temDesconto: true as boolean | null,
    // Vazios: a folha mensal da Prefeitura não traz nenhum destes. Os testes
    // que exercitam o export legado preenchem o que precisam.
    cpf: '',
    telefone: '',
    email: '',
    endereco: '',
    dataNascimento: '',
    dataAdmissao: '',
    ...over,
  };
  return { ...base, chave: normalizarMatricula(base.matricula) };
};

const vinculo = (over: Partial<VinculoExistente> = {}): VinculoExistente => ({
  vinculoId: 'v1',
  filiadoId: 'f1',
  filiadoNome: 'MARIA DA SILVA',
  orgao: 'SEMEC',
  matricula: '12345',
  cargo: 'PROFESSOR',
  lotacao: 'ESCOLA MUNICIPAL X',
  quadro: 'EFETIVO',
  descontoEmFolha: true,
  ...over,
});

/** Monta os índices como o service monta a partir do banco. */
function base(
  vinculos: VinculoExistente[] = [],
  filiados: { id: string; nome: string; matricula?: string }[] = [],
): BaseAtual {
  const porMatricula = new Map<string, VinculoExistente>();
  for (const v of vinculos) {
    const m = normalizarMatricula(v.matricula);
    if (m && !porMatricula.has(m)) porMatricula.set(m, v);
  }
  const porNome = new Map<string, { filiadoId: string; nome: string }[]>();
  const porMatriculaFiliado = new Map<string, { filiadoId: string; nome: string }>();
  for (const f of filiados) {
    const k = normalizarTexto(f.nome);
    porNome.set(k, [...(porNome.get(k) ?? []), { filiadoId: f.id, nome: f.nome }]);
    const m = normalizarMatricula(f.matricula);
    if (m) porMatriculaFiliado.set(m, { filiadoId: f.id, nome: f.nome });
  }
  return { porMatricula, porMatriculaFiliado, porNome };
}

const julgar = (l: LinhaFolha, b: BaseAtual, vistas = new Map<string, number>(), n = 1) =>
  classificarLinha(l, b, vistas, n);

// ---------------------------------------------------------------------------

describe('normalização', () => {
  it('ignora acento, caixa e espaço duplo no órgão', () => {
    expect(normalizarTexto('  Secretaria   de Educação ')).toBe('SECRETARIA DE EDUCACAO');
  });

  it('matrícula: o zero à esquerda que o Excel come não cria pessoa nova', () => {
    // A MESMA planilha alterna os dois conforme a coluna saia como texto ou
    // como número. Se fossem chaves diferentes, cada reexportação duplicaria
    // a base inteira.
    expect(normalizarMatricula('0012345')).toBe(normalizarMatricula('12345'));
  });

  it('matrícula só de zeros não vira string vazia', () => {
    // Vazio significaria "sem matrícula", e a linha seria recusada por outro
    // motivo que não o verdadeiro.
    expect(normalizarMatricula('000')).toBe('0');
  });

});

describe('Valor → desconto em folha (o número é descartado)', () => {
  it.each([
    ['123,45', true],
    ['1.234,56', true],
    ['R$ 89,90', true],
    ['0,01', true],
    ['1234.56', true],
  ])('“%s” indica desconto', (valor, esperado) => {
    expect(descontoNaFolha(valor)).toBe(esperado);
  });

  it.each([['0,00'], ['0'], ['R$ 0,00']])('“%s” NÃO indica desconto', (valor) => {
    // Quem está na folha com zero não contribui — e é por isso que a coluna
    // Valor precisa ser lida, ainda que a quantia não seja guardada.
    expect(descontoNaFolha(valor)).toBe(false);
  });

  it.each([[''], ['   '], [null], [undefined], ['-']])(
    'sem informação (%s) devolve null — diferente de “é zero”',
    (valor) => {
      expect(descontoNaFolha(valor as string | null | undefined)).toBeNull();
    },
  );
});

describe('comparação de nomes', () => {
  it('preposição não conta: "MARIA DE SOUZA" e "MARIA SOUZA" são o mesmo nome', () => {
    expect(compararNomes('MARIA DE SOUZA', 'Maria Souza')).toBe('IGUAL');
  });

  it('abreviação do meio é compatível — é o padrão da folha de pagamento', () => {
    expect(compararNomes('MARIA S DA COSTA', 'MARIA SILVA DA COSTA')).toBe('COMPATIVEL');
  });

  it('nome do meio a mais não contradiz', () => {
    expect(compararNomes('JOAO PEREIRA LIMA', 'JOAO LIMA')).toBe('COMPATIVEL');
  });

  it('sobrenome diferente é pessoa diferente', () => {
    expect(compararNomes('MARIA DA SILVA', 'MARIA DA COSTA')).toBe('DIFERENTE');
  });

  it('só o primeiro nome não basta para nada', () => {
    expect(compararNomes('MARIA', 'MARIA DA SILVA')).toBe('DIFERENTE');
  });

  it('tokensNome descarta as partículas', () => {
    expect(tokensNome('José das Dores E Silva')).toEqual(['JOSE', 'DORES', 'SILVA']);
  });
});

describe('reconhecimento do layout', () => {
  it('reconhece a folha da Prefeitura pelas três colunas que a identificam', () => {
    expect(
      pareceFolhaPrefeitura(['Órgão', 'Matrícula', 'Nome', 'Quadro', 'Lotação', 'Cargo', 'Valor']),
    ).toBe(true);
  });

  it('NÃO confunde com o CSV legado, que tem nome e matrícula mas não tem órgão', () => {
    // Ler o legado por este perfil ignoraria o CPF de 7.000 pessoas — a única
    // âncora de identidade confiável que aquela base tem.
    expect(pareceFolhaPrefeitura(['nrmatricula', 'nome', 'cpf', 'datanascimento'])).toBe(false);
  });

  it('aceita variação de cabeçalho entre competências', () => {
    expect(pareceFolhaPrefeitura(['SECRETARIA', 'MAT', 'NOME SERVIDOR', 'UNID. LOTACAO'])).toBe(true);
  });

  it('a QUANTIA de Valor não sobrevive à normalização — só o sim/não', () => {
    const colunas = mapearColunas(['Órgão', 'Matrícula', 'Nome', 'Valor']);
    const l = normalizarLinha(
      { 'Órgão': 'SEMEC', 'Matrícula': '1', Nome: 'X Y', Valor: '123,45' },
      colunas,
    );
    expect(JSON.stringify(l)).not.toContain('123');
    expect(l.temDesconto).toBe(true);
  });

  it('planilha SEM a coluna Valor não conclui nada sobre desconto', () => {
    const colunas = mapearColunas(['Órgão', 'Matrícula', 'Nome']);
    const l = normalizarLinha({ 'Órgão': 'SEMEC', 'Matrícula': '1', Nome: 'X Y' }, colunas);
    expect(l.temDesconto).toBeNull();
  });

  it('a mesma coluna não é reivindicada duas vezes', () => {
    // "MATRICULA ANTIGA" não pode roubar o mapeamento de "MATRICULA".
    const colunas = mapearColunas(['Matrícula', 'Matr', 'Nome', 'Órgão']);
    expect(colunas.filter((c) => c.campo === 'matricula')).toHaveLength(1);
    expect(colunas[0].campo).toBe('matricula');
  });
});

describe('classificação — o que a prévia decide', () => {
  it('ninguém parecido: NOVO', () => {
    expect(julgar(linha(), base()).classificacao).toBe('NOVO');
  });

  it('órgão + matrícula batendo: ATUALIZACAO', () => {
    const v = julgar(linha({ cargo: 'COORDENADOR' }), base([vinculo()]));
    expect(v.classificacao).toBe('ATUALIZACAO');
    expect(v.alteracoes.cargo).toEqual({ de: 'PROFESSOR', para: 'COORDENADOR' });
  });

  it('cadastro já igual à planilha não conta como alteração', () => {
    const v = julgar(linha(), base([vinculo()]));
    expect(v.classificacao).toBe('ATUALIZACAO');
    expect(Object.keys(v.alteracoes)).toHaveLength(0);
  });

  it('matrícula com zero à esquerda continua reconhecendo o mesmo vínculo', () => {
    const v = julgar(linha({ matricula: '0012345' }), base([vinculo({ matricula: '12345' })]));
    expect(v.classificacao).toBe('ATUALIZACAO');
  });

  it('mesma matrícula em OUTRO órgão é TRANSFERÊNCIA, não conflito', () => {
    // A matrícula é única no município: vê-la em outra secretaria significa que
    // a pessoa foi transferida. Mandar isso para decisão manual encheria a fila
    // de casos sem dúvida nenhuma.
    const v = julgar(linha({ orgao: 'SEMDEC' }), base([vinculo({ orgao: 'SEMEC' })]));
    expect(v.classificacao).toBe('ATUALIZACAO');
    expect(v.alteracoes.orgao).toEqual({ de: 'SEMEC', para: 'SEMDEC' });
    expect(v.vinculoId).toBe('v1'); // o MESMO vínculo, não um segundo
  });

  it('transferência com nome divergente continua sendo conflito', () => {
    const v = julgar(
      linha({ orgao: 'SEMDEC', nome: 'JOAO PEREIRA' }),
      base([vinculo({ orgao: 'SEMEC', filiadoNome: 'MARIA DA SILVA' })]),
    );
    expect(v.classificacao).toBe('CONFLITO');
    expect(v.motivo).toBe('NOME_DIVERGENTE');
  });

  it('cadastrado no balcão com a matrícula, mas sem vínculo: cria o vínculo', () => {
    const v = julgar(linha(), base([], [{ id: 'f7', nome: 'MARIA DA SILVA', matricula: '12345' }]));
    expect(v.classificacao).toBe('ATUALIZACAO');
    expect(v.candidatoId).toBe('f7');
    expect(v.avisos.join(' ')).toContain('sem vínculo funcional');
  });

  it('matrícula do cadastro batendo com nome de outra pessoa é conflito', () => {
    const v = julgar(
      linha({ nome: 'JOAO PEREIRA' }),
      base([], [{ id: 'f7', nome: 'MARIA DA SILVA', matricula: '12345' }]),
    );
    expect(v.classificacao).toBe('CONFLITO');
    expect(v.motivo).toBe('NOME_DIVERGENTE');
  });

  it('órgão em branco não barra o servidor — a matrícula é que identifica', () => {
    const v = julgar(linha({ orgao: '' }), base());
    expect(v.classificacao).toBe('NOVO');
    expect(v.avisos.join(' ')).toContain('Órgão em branco');
  });

  it('o desconto que CHEGA no mês seguinte ativa sozinho na próxima folha', () => {
    // O caso do sindicato: a pessoa se filia, o desconto só entra na folha do
    // mês seguinte. Ela foi importada sem desconto; quando o primeiro desconto
    // aparece, a competência seguinte vira o campo e registra a virada no
    // histórico — sem ninguém precisar caçar quem já começou a pagar.
    const v = julgar(linha({ temDesconto: true }), base([vinculo({ descontoEmFolha: false })]));
    expect(v.classificacao).toBe('ATUALIZACAO');
    expect(v.alteracoes.descontoEmFolha).toEqual({ de: 'false', para: 'true' });
  });

  it('desconto que sai da folha também é registrado', () => {
    const v = julgar(linha({ temDesconto: false }), base([vinculo({ descontoEmFolha: true })]));
    expect(v.classificacao).toBe('ATUALIZACAO');
    expect(v.alteracoes.descontoEmFolha).toEqual({ de: 'true', para: 'false' });
  });

  it('matrícula igual com CPF DIFERENTE é conflito — não carimba documento em ninguém', () => {
    const v = julgar(
      linha({ cpf: '20779720334' }),
      base([vinculo({ filiadoCpf: '11144477735' })]),
    );
    expect(v.classificacao).toBe('CONFLITO');
    expect(v.motivo).toBe('CPF_DIVERGENTE');
    expect(v.alteracoes).toEqual({});
  });

  it('CPF só no arquivo (cadastro sem CPF) completa, não conflita', () => {
    const v = julgar(linha({ cpf: '20779720334' }), base([vinculo({ filiadoCpf: null })]));
    expect(v.classificacao).toBe('ATUALIZACAO');
  });

  it('planilha sem a coluna Valor NÃO mexe no desconto de quem já contribui', () => {
    // Mexer aqui invalidaria a carteirinha de quem paga, por omissão da origem.
    const v = julgar(linha({ temDesconto: null }), base([vinculo({ descontoEmFolha: true })]));
    expect(v.alteracoes.descontoEmFolha).toBeUndefined();
  });

  it('matrícula reaproveitada por outra pessoa: CONFLITO, não sobrescreve', () => {
    // O caso perigoso: a matrícula bate, mas quem a tem hoje é outro servidor.
    // Atualizar aqui gravaria o cargo do novo por cima da ficha do antigo.
    const v = julgar(linha({ nome: 'JOAO PEREIRA' }), base([vinculo({ filiadoNome: 'MARIA DA SILVA' })]));
    expect(v.classificacao).toBe('CONFLITO');
    expect(v.motivo).toBe('NOME_DIVERGENTE');
    expect(v.alteracoes).toEqual({});
  });

  it('grafia diferente do mesmo nome ainda atualiza, mas avisa', () => {
    const v = julgar(linha({ nome: 'MARIA S SILVA' }), base([vinculo({ filiadoNome: 'MARIA DA SILVA' })]));
    expect(v.classificacao).toBe('ATUALIZACAO');
    expect(v.avisos.join(' ')).toContain('Nome grafado de forma diferente');
  });

  it('NOME IGUAL COM MATRÍCULA NOVA NUNCA FUNDE — vai para decisão humana', () => {
    // A regra central do módulo. "MARIA DA SILVA" é homônimo de muita gente
    // numa folha de 4.000 servidores; casar por nome fundiria pessoas reais.
    const v = julgar(linha({ matricula: '99999' }), base([], [{ id: 'f9', nome: 'MARIA DA SILVA' }]));
    expect(v.classificacao).toBe('CONFLITO');
    expect(v.motivo).toBe('NOME_SEMELHANTE');
    expect(v.candidatoId).toBe('f9');
  });

  it('a mesma matrícula duas vezes no arquivo: a segunda é DUPLICIDADE', () => {
    const vistas = new Map<string, number>();
    expect(julgar(linha(), base(), vistas, 7).classificacao).toBe('NOVO');
    const segunda = julgar(linha(), base(), vistas, 42);
    expect(segunda.classificacao).toBe('DUPLICIDADE');
    expect(segunda.avisos.join(' ')).toContain('linha 7');
  });

  it.each([
    ['sem nome', { nome: '' }],
    ['sem matrícula', { matricula: '' }],
  ])('linha %s é ERRO e não entra de jeito nenhum', (_rotulo, over) => {
    const v = julgar(linha(over as Partial<LinhaFolha>), base());
    expect(v.classificacao).toBe('ERRO');
    expect(v.erros.length).toBeGreaterThan(0);
  });
});

describe('a regra que não pode quebrar: vazio não apaga', () => {
  it('coluna ausente na competência NÃO limpa o que já está gravado', () => {
    // O cenário real: a folha de agosto vem sem a coluna "Lotação". Um update
    // cego apagaria a lotação de 4.000 pessoas de uma vez.
    const alteracoes = diferencasDoVinculo(
      linha({ lotacao: '', cargo: '', quadro: '' }),
      vinculo({ lotacao: 'ESCOLA X', cargo: 'PROFESSOR', quadro: 'EFETIVO' }),
    );
    expect(alteracoes).toEqual({});
  });

  it('preenche o que está vazio no cadastro', () => {
    const alteracoes = diferencasDoVinculo(linha({ cargo: 'PROFESSOR' }), vinculo({ cargo: null }));
    expect(alteracoes.cargo).toEqual({ de: null, para: 'PROFESSOR' });
  });

  it('diferença só de acento e caixa não vira alteração', () => {
    // Sem isto, toda competência marcaria 4.000 "atualizações" que não mudam
    // nada e encheriam o histórico de ruído.
    const alteracoes = diferencasDoVinculo(
      linha({ cargo: 'Auxiliar Administrativo' }),
      vinculo({ cargo: 'AUXILIAR ADMINISTRATIVO' }),
    );
    expect(alteracoes).toEqual({});
  });

  it('o nome do cadastro existente não é sobrescrito pelo da planilha', () => {
    // Alguém pode ter corrigido o nome à mão; a folha voltaria a estragar a
    // correção a cada competência.
    expect(camposParaCompletar(linha({ nome: 'MARIA D SILVA' }), { nomeCompleto: 'MARIA DA SILVA' }))
      .toEqual({});
  });

  it('mas completa o nome quando o cadastro está sem', () => {
    expect(camposParaCompletar(linha({ nome: 'MARIA DA SILVA' }), { nomeCompleto: '' }))
      .toEqual({ nomeCompleto: 'MARIA DA SILVA' });
  });
});
