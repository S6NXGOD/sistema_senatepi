import {
  conferirLinha,
  conferirPlanilha,
  lerData,
  lerReus,
  normalizarCabecalho,
} from './processos-csv.util';

/** Linha mínima válida — os testes mexem só no que estão medindo. */
const base = (extra: Record<string, string> = {}) => ({
  npu: '0001193-66.2021.5.22.0005',
  polo_ativo: 'INSTITUCIONAL',
  reu_nome: 'SÃO CARLOS BORROMEO',
  reu_cnpj: '',
  advogado_email: 'adv@sindicato.org',
  ...extra,
});

describe('cabeçalho', () => {
  it('aceita como o Excel escreveu — maiúscula, acento e espaço', () => {
    expect(normalizarCabecalho(' NPU ')).toBe('npu');
    expect(normalizarCabecalho('Polo Ativo')).toBe('polo_ativo');
    expect(normalizarCabecalho('Categoria')).toBe('categoria');
    expect(normalizarCabecalho('andamento_data')).toBe('andamento_data');
  });
});

/**
 * O NPU É A ÚNICA COISA SEM A QUAL NADA FUNCIONA: é por ele que o sistema
 * consulta o CNJ. Um dígito trocado devolve "não encontrado" 40 minutos depois,
 * e aí ninguém sabe se o processo não existe ou se o número está errado.
 */
describe('NPU', () => {
  it('aceita com e sem máscara', () => {
    expect(conferirLinha(base(), 2).erros).toEqual([]);
    expect(conferirLinha(base({ npu: '00011936620215220005' }), 2).erros).toEqual([]);
  });

  it('recusa dígito verificador errado', () => {
    // Mesmo número, DV trocado de 66 para 67.
    const r = conferirLinha(base({ npu: '0001193-67.2021.5.22.0005' }), 2);
    expect(r.erros.join()).toMatch(/dígito verificador não confere/);
  });

  it('recusa tamanho errado e diz quantos vieram', () => {
    expect(conferirLinha(base({ npu: '123' }), 2).erros.join()).toMatch(/20 dígitos.*veio com 3/);
  });

  it('recusa linha sem NPU', () => {
    expect(conferirLinha(base({ npu: '' }), 2).erros.join()).toMatch(/Sem número do processo/);
  });
});

/**
 * O POLO INVERTIDO É O PIOR ERRO POSSÍVEL desta importação. Na planilha real,
 * DOIS processos têm o sindicato como RÉU (ação rescisória do SINSEP, dissídio
 * do SINDHOSPI). Entrando como institucionais, o sistema diria que o SENATEPI
 * processou quem na verdade o processou.
 */
describe('polo ativo', () => {
  it('OUTRA exige o nome de quem move a ação', () => {
    const r = conferirLinha(base({ polo_ativo: 'OUTRA', polo_ativo_nome: '' }), 2);
    expect(r.erros.join()).toMatch(/OUTRA exige o nome/);
  });

  it('OUTRA com nome passa — é o caso do SINSEP contra o sindicato', () => {
    const r = conferirLinha(base({ polo_ativo: 'OUTRA', polo_ativo_nome: 'SINSEP' }), 2);
    expect(r.erros).toEqual([]);
    expect(r.poloAtivoNome).toBe('SINSEP');
  });

  it('recusa polo que não existe', () => {
    expect(conferirLinha(base({ polo_ativo: 'SINDICATO' }), 2).erros.join()).toMatch(/não existe/);
  });

  it('avisa que INSTITUCIONAL ignora o nome do autor', () => {
    const r = conferirLinha(base({ polo_ativo_nome: 'ALGUÉM' }), 2);
    expect(r.erros).toEqual([]);
    expect(r.avisos.join()).toMatch(/ignora polo_ativo_nome/);
  });
});

/**
 * FILIADOS SEM CPF É AVISO, NÃO ERRO — foi a orientação: o processo entra sem
 * vínculo. Barrar a linha inteira por causa disso deixaria 10 dos 20 processos
 * individuais de fora.
 */
describe('filiado', () => {
  it('sem CPF entra, com aviso nomeando quem ficou de fora', () => {
    const r = conferirLinha(base({ polo_ativo: 'FILIADOS', filiado_nome: 'VILMA NONATA' }), 2);
    expect(r.erros).toEqual([]);
    expect(r.avisos.join()).toMatch(/Sem CPF de "VILMA NONATA".*SEM filiado/);
  });

  it('CPF com tamanho errado é descartado em vez de gravar lixo', () => {
    const r = conferirLinha(base({ polo_ativo: 'FILIADOS', filiado_cpf: '123' }), 2);
    expect(r.filiadoCpf).toBe('');
    expect(r.avisos.join()).toMatch(/3 dígitos/);
  });

  it('CPF válido é mantido só com dígitos', () => {
    const r = conferirLinha(base({ polo_ativo: 'FILIADOS', filiado_cpf: '123.456.789-09' }), 2);
    expect(r.filiadoCpf).toBe('12345678909');
  });
});

describe('réus', () => {
  it('lê vários separados por barra, com os CNPJs na mesma ordem', () => {
    expect(lerReus('UNIMED ADULTA|UNIMED INFANTIL', '07241136000132|')).toEqual([
      { nome: 'UNIMED ADULTA', cnpj: '07241136000132' },
      { nome: 'UNIMED INFANTIL', cnpj: '' },
    ]);
  });

  it('sem CNPJ avisa que a razão social precisa de conferência', () => {
    const r = conferirLinha(base({ reu_nome: 'MAT. MARQUES BASTOS' }), 2);
    expect(r.erros).toEqual([]);
    expect(r.avisos.join()).toMatch(/sem CNPJ.*confira a razão social/);
  });

  it('sem réu nenhum entra, e avisa que o processo fica "sem réu"', () => {
    const r = conferirLinha(base({ reu_nome: '' }), 2);
    expect(r.erros).toEqual([]);
    expect(r.avisos.join()).toMatch(/Sem parte contrária/);
  });
});

describe('categoria', () => {
  it('aceita slug do catálogo', () => {
    expect(conferirLinha(base({ categoria: 'SINDICAL_COLETIVO' }), 2).categoria).toBe('SINDICAL_COLETIVO');
  });

  it('slug inventado vira vazio, com aviso — não bloqueia', () => {
    const r = conferirLinha(base({ categoria: 'TRABALHISTAS' }), 2);
    expect(r.categoria).toBe('');
    expect(r.erros).toEqual([]);
    expect(r.avisos.join()).toMatch(/não existe/);
  });
});

/**
 * A DATA DO ANDAMENTO decide se a importação joga o acervo inteiro para o topo
 * da lista. Sem ela, oitenta notas datadas de hoje fazem todos os processos
 * parecerem recém-movimentados de uma vez.
 */
describe('data do andamento', () => {
  it.each([
    ['2026-08-15', '2026-08-15'],
    ['15/08/2026', '2026-08-15'],
    ['5/8/2026', '2026-08-05'],
    ['2026-08', '2026-08-01'],
  ])('lê %s', (bruta, esperada) => {
    expect(lerData(bruta)).toBe(esperada);
  });

  it('data ilegível não bloqueia — só avisa', () => {
    const r = conferirLinha(base({ andamento: 'Sentença de procedência', andamento_data: 'agosto' }), 2);
    expect(r.erros).toEqual([]);
    expect(r.andamentoData).toBe('');
    expect(r.avisos.join()).toMatch(/não reconhecida/);
  });

  it('andamento sem data avisa que sobe o processo na lista', () => {
    const r = conferirLinha(base({ andamento: 'Sentença de procedência' }), 2);
    expect(r.avisos.join()).toMatch(/sobe o processo na lista/);
  });

  it('sem andamento não reclama de data', () => {
    expect(conferirLinha(base(), 2).avisos.join()).not.toMatch(/data/i);
  });
});

describe('advogado', () => {
  it('ausente é aviso, não erro — corrige-se na ficha depois', () => {
    const r = conferirLinha(base({ advogado_email: '' }), 2);
    expect(r.erros).toEqual([]);
    expect(r.avisos.join()).toMatch(/carteira/);
  });
});

describe('planilha inteira', () => {
  const cab = ['npu', 'polo_ativo', 'reu_nome'];

  it('exige as colunas obrigatórias', () => {
    const r = conferirPlanilha(['npu'], [{ npu: '0001193-66.2021.5.22.0005' }]);
    expect(r.problemasNoArquivo.join()).toMatch(/Falta a coluna "polo_ativo"/);
  });

  it('avisa sobre coluna que não entende, sem recusar o arquivo', () => {
    const r = conferirPlanilha([...cab, 'fase'], [
      { npu: '0001193-66.2021.5.22.0005', polo_ativo: 'INSTITUCIONAL', reu_nome: 'X', fase: 'Execução' },
    ]);
    expect(r.problemasNoArquivo.join()).toMatch(/Colunas ignoradas: fase/);
    expect(r.linhas[0].erros).toEqual([]);
  });

  /**
   * NPU repetido no arquivo tem de ser pego AQUI. No banco, a segunda tentativa
   * bateria no 409 do endpoint e viraria "erro de importação" — quando o
   * problema está na planilha, e a mensagem precisa dizer isso.
   */
  it('pega NPU repetido e aponta a linha anterior', () => {
    const linha = { npu: '0001193-66.2021.5.22.0005', polo_ativo: 'INSTITUCIONAL', reu_nome: 'X' };
    const r = conferirPlanilha(cab, [linha, linha]);
    expect(r.linhas[0].erros).toEqual([]);
    expect(r.linhas[1].erros.join()).toMatch(/repetido.*linha 2/);
  });

  it('a numeração conta o cabeçalho como linha 1', () => {
    const r = conferirPlanilha(cab, [
      { npu: '0001193-66.2021.5.22.0005', polo_ativo: 'INSTITUCIONAL', reu_nome: 'X' },
    ]);
    expect(r.linhas[0].linha).toBe(2);
  });
});
