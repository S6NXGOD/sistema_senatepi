import * as ExcelJS from 'exceljs';
import { lerCabecalhos, lerPlanilha } from './planilha.util';
import { mapearColunas, normalizarLinha, pareceFolhaPrefeitura } from './folha-prefeitura.util';

/**
 * Leitura de arquivo de verdade — xlsx gerado aqui, byte a byte, e CSV.
 *
 * O que se verifica é o que a planilha da Prefeitura faz com os dados no
 * caminho até o sistema: o Excel come o zero à esquerda da matrícula, o
 * arquivo vem com brasão e título antes do cabeçalho, e a última linha é um
 * total que não é servidor nenhum. Cada um desses já bastaria para a
 * importação ler a coluna errada — e ler a coluna errada, aqui, é gravar o
 * cargo de uma pessoa na ficha de outra.
 */

const CABECALHO = ['Órgão', 'Matrícula', 'Nome', 'Quadro', 'Lotação', 'Cargo', 'Valor'];

/** Monta um .xlsx em memória, opcionalmente com linhas de enfeite antes. */
async function montarXlsx(
  linhas: (string | number)[][],
  opts: { preambulo?: string[][] } = {},
): Promise<{ originalname: string; buffer: Buffer }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Folha');
  for (const p of opts.preambulo ?? []) ws.addRow(p);
  ws.addRow(CABECALHO);
  for (const l of linhas) ws.addRow(l);
  const arr = await wb.xlsx.writeBuffer();
  return { originalname: 'folha.xlsx', buffer: Buffer.from(arr) };
}

describe('leitura da planilha', () => {
  it('lê um xlsx no formato da folha e reconhece o layout', async () => {
    const file = await montarXlsx([
      ['SEMEC', '0012345', 'MARIA DA SILVA', 'EFETIVO', 'ESCOLA X', 'PROFESSOR', '123,45'],
    ]);
    const { cabecalhos, linhas } = await lerPlanilha(file);

    expect(cabecalhos).toEqual(CABECALHO);
    expect(linhas).toHaveLength(1);
    expect(pareceFolhaPrefeitura(cabecalhos)).toBe(true);
  });

  it('acha o cabeçalho mesmo com brasão e título antes dele', async () => {
    // Planilha de órgão público quase nunca começa na linha 1.
    const file = await montarXlsx(
      [['SEMEC', '1', 'JOAO LIMA', 'EFETIVO', 'ESCOLA Y', 'PROFESSOR', '1']],
      { preambulo: [['PREFEITURA MUNICIPAL DE TERESINA'], ['RELAÇÃO DE SERVIDORES — 08/2026'], []] },
    );
    const { cabecalhos, linhas } = await lerPlanilha(file);
    expect(cabecalhos).toEqual(CABECALHO);
    expect(linhas[0]['Nome']).toBe('JOAO LIMA');
  });

  it('matrícula gravada como NÚMERO pelo Excel não vira "[object Object]" nem perde a pessoa', async () => {
    // 12345 (número) e '0012345' (texto) precisam chegar ao mesmo servidor.
    const file = await montarXlsx([
      ['SEMEC', 12345, 'MARIA DA SILVA', 'EFETIVO', 'ESCOLA X', 'PROFESSOR', 10],
    ]);
    const { cabecalhos, linhas } = await lerPlanilha(file);
    const l = normalizarLinha(linhas[0], mapearColunas(cabecalhos));
    expect(l.matricula).toBe('12345');
    expect(l.chave).toBe('12345');
  });

  it('linha totalmente vazia no fim do arquivo não vira registro', async () => {
    const file = await montarXlsx([
      ['SEMEC', '1', 'JOAO LIMA', 'EFETIVO', 'ESCOLA Y', 'PROFESSOR', '1'],
      ['', '', '', '', '', '', ''],
    ]);
    const { linhas } = await lerPlanilha(file);
    expect(linhas).toHaveLength(1);
  });

  it('a coluna Valor é lida e DESCARTADA — não sobra em lugar nenhum', async () => {
    const file = await montarXlsx([
      ['SEMEC', '1', 'JOAO LIMA', 'EFETIVO', 'ESCOLA Y', 'PROFESSOR', '987,65'],
    ]);
    const { cabecalhos, linhas } = await lerPlanilha(file);
    const l = normalizarLinha(linhas[0], mapearColunas(cabecalhos));
    expect(JSON.stringify(l)).not.toContain('987');
  });

  it('lê CSV com ponto-e-vírgula e acento (exportação típica daqui)', async () => {
    const csv =
      'Órgão;Matrícula;Nome;Quadro;Lotação;Cargo;Valor\n' +
      'SEMEC;0012345;MARIA DA SILVA;EFETIVO;ESCOLA X;PROFESSOR;123,45\n';
    const { cabecalhos, linhas } = await lerPlanilha({
      originalname: 'folha.csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    expect(pareceFolhaPrefeitura(cabecalhos)).toBe(true);
    const l = normalizarLinha(linhas[0], mapearColunas(cabecalhos));
    expect(l.nome).toBe('MARIA DA SILVA');
    expect(l.chave).toBe('12345');
  });

  it('CSV em latin1 não vira caractere quebrado', async () => {
    const csv =
      'Órgão;Matrícula;Nome;Lotação\n' + 'FUNDAÇÃO;1;JOÃO DA CONCEIÇÃO;UNIDADE Nº 3\n';
    const { linhas } = await lerPlanilha({
      originalname: 'folha.csv',
      buffer: Buffer.from(csv, 'latin1'),
    });
    expect(linhas[0]['Nome']).toBe('JOÃO DA CONCEIÇÃO');
  });

  it('lerCabecalhos devolve só os títulos — é o que decide qual importador roda', async () => {
    const file = await montarXlsx([['SEMEC', '1', 'X Y', 'E', 'L', 'C', '1']]);
    expect(await lerCabecalhos(file)).toEqual(CABECALHO);
  });

  it('lê o export do banco legado do SINDSERM e aproveita o que a folha não tem', async () => {
    const csv =
      'id,name,cpf,registration,lotacao,position,orgao,status,employment_status,' +
      'telefone,email,endereco,admission_date,birth_date,possui_desconto\n' +
      '7a00c6a4,Francisco Gomes da Silva,207.797.203-34,026318,FMS,Auxiliar Operacional,' +
      'FMS,active,active,86999998888,f@x.com,Rua A 10,2010-01-02,1980-03-04,true\n';
    const { cabecalhos, linhas } = await lerPlanilha({
      originalname: 'filiados.csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    const l = normalizarLinha(linhas[0], mapearColunas(cabecalhos));

    expect(l.nome).toBe('Francisco Gomes da Silva');
    expect(l.matricula).toBe('026318');
    expect(l.chave).toBe('26318'); // zero à esquerda some — é a mesma matrícula
    expect(l.orgao).toBe('FMS');
    expect(l.cargo).toBe('Auxiliar Operacional');
    expect(l.cpf).toBe('20779720334');
    expect(l.telefone).toBe('86999998888');
    expect(l.dataNascimento).toBe('1980-03-04');
    // `possui_desconto` do sistema antigo é afirmação direta e vale mais que
    // qualquer inferência de Valor.
    expect(l.temDesconto).toBe(true);
  });

  it('CPF inválido do legado é descartado em vez de virar identidade falsa', async () => {
    const csv = 'name,registration,orgao,cpf\nX Y,1,FMS,111.111.111-11\n';
    const { cabecalhos, linhas } = await lerPlanilha({
      originalname: 'f.csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    const l = normalizarLinha(linhas[0], mapearColunas(cabecalhos));
    expect(l.cpf).toBe('');
    expect(l.nome).toBe('X Y'); // a pessoa entra; só o CPF ruim fica de fora
  });

  it('recusa extensão não suportada antes de processar', async () => {
    await expect(
      lerPlanilha({ originalname: 'folha.pdf', buffer: Buffer.from('x') }),
    ).rejects.toThrow(/Formato não suportado/);
  });

  it('recusa arquivo sem nenhuma linha de dados', async () => {
    const file = await montarXlsx([]);
    await expect(lerPlanilha(file)).rejects.toThrow(/nenhuma linha de dados/);
  });
});
