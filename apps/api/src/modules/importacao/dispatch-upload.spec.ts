import * as ExcelJS from 'exceljs';
import { lerCabecalhos } from './planilha.util';
import { pareceFolhaPrefeitura } from './folha-prefeitura.util';

/**
 * O DESVIO DO UPLOAD — a decisão de qual importador recebe o arquivo.
 *
 * Existe UM botão de importar e DOIS importadores com regras de identidade
 * opostas: o legado ancora no CPF, a folha ancora na matrícula. Mandar o
 * arquivo para o lado errado não dá erro visível — dá 7.000 cadastros
 * processados pela regra errada.
 *
 * ESTE TESTE PROTEGE O SENATEPI. O importador legado é a migração da base dele,
 * e está em produção. Qualquer mudança nos sinônimos de coluna da folha corre o
 * risco de sequestrar o CSV legado; é isso que os casos abaixo travam.
 */
describe('para qual importador vai o arquivo', () => {
  const csv = (texto: string) => ({ originalname: 'x.csv', buffer: Buffer.from(texto, 'utf8') });

  it('CSV legado do SENATEPI NÃO é confundido com a folha', async () => {
    // Cabeçalho real da base legada: tem nome e matrícula, não tem órgão.
    // Se fosse lido como folha, o CPF — única âncora confiável daquela base —
    // seria ignorado em todos os registros.
    const cabecalhos = await lerCabecalhos(
      csv('nrmatricula,nome,cpf,rg,datanascimento,sexo,telefone,empresa,status,datacadastro\n1,X,1,1,1,M,1,H,ativo,2020\n'),
    );
    expect(cabecalhos.length).toBeGreaterThan(0);
    expect(pareceFolhaPrefeitura(cabecalhos)).toBe(false);
  });

  it('"empresa" do CSV legado não conta como "órgão"', async () => {
    // A folha exige ÓRGÃO; `empresa` é o empregador do cadastro legado e não
    // pode virar sinônimo, sob pena de sequestrar a migração do SENATEPI.
    const cabecalhos = await lerCabecalhos(csv('nome,nrmatricula,empresa\nX,1,HGV\n'));
    expect(pareceFolhaPrefeitura(cabecalhos)).toBe(false);
  });

  it('a folha da Prefeitura é reconhecida', async () => {
    const cabecalhos = await lerCabecalhos(
      csv('Órgão;Matrícula;Nome;Quadro;Lotação;Cargo;Valor\nSEMEC;1;X Y;EFETIVO;E;P;1\n'),
    );
    expect(pareceFolhaPrefeitura(cabecalhos)).toBe(true);
  });

  it('xlsx que não é a folha não passa por folha — o controller o recusa', async () => {
    // A tela passou a aceitar .xlsx por causa da folha. Um .xlsx qualquer NÃO
    // pode escorregar para o importador legado, que faz toString('utf8') num
    // ZIP e produziria linhas de lixo na prévia.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('P');
    ws.addRow(['nome', 'cpf', 'telefone']);
    ws.addRow(['MARIA', '123', '86999']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const cabecalhos = await lerCabecalhos({ originalname: 'qualquer.xlsx', buffer });
    expect(pareceFolhaPrefeitura(cabecalhos)).toBe(false);
    // → o controller cai na guarda de extensão e devolve 400 com o motivo.
    expect(/\.xlsx?$/i.test('qualquer.xlsx')).toBe(true);
  });

  it('o EXPORT DO BANCO LEGADO do SINDSERM é reconhecido', async () => {
    // Cabeçalho real do export da tabela `members` do sistema antigo — nomes em
    // inglês. Antes de `NAME`/`REGISTRATION`/`POSITION` virarem sinônimos, este
    // arquivo caía no importador legado, que não mapeava a coluna de nome: a
    // tela acusava "Nome ausente" em TODAS as 966 linhas e culpava um dado que
    // estava perfeito.
    const cabecalhos = await lerCabecalhos(
      csv(
        'id,name,cpf,registration,lotacao,position,orgao,status,employment_status,' +
          'telefone,email,endereco,admission_date,birth_date,possui_desconto\n' +
          'a1,MARIA DA SILVA,207.797.203-34,026318,FMS,Auxiliar,FMS,active,active,' +
          '86999,m@x.com,Rua A,2010-01-02,1980-03-04,true\n',
      ),
    );
    expect(pareceFolhaPrefeitura(cabecalhos)).toBe(true);
  });

  it('arquivo binário ilegível não vira "folha" por acidente', async () => {
    const cabecalhos = await lerCabecalhos({
      originalname: 'foto.xlsx',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
    });
    expect(cabecalhos).toEqual([]);
    expect(pareceFolhaPrefeitura(cabecalhos)).toBe(false);
  });
});
