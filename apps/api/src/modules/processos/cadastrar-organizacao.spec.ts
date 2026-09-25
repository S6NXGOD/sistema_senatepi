import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { PartesExternasController } from './partes.controller';
import { AtualizarParteExternaDto, CriarParteExternaDto } from './dto/partes.dto';

/**
 * "PROPERTY ENTECODIGO SHOULD NOT EXIST" — erro de produção, 25/09/2026.
 *
 * A tela de organizações monta UM objeto e o manda para DUAS rotas: `POST`
 * quando é nova, `PATCH` quando é edição. O campo `enteCodigo` (o "Ente público
 * responsável", que diz quem paga a folha daquela organização) foi declarado só
 * no DTO do PATCH.
 *
 * Com `forbidNonWhitelisted: true`, o POST passou a responder **400**. E o corpo
 * leva `enteCodigo: null` mesmo quando ninguém escolhe ente — então **nenhuma
 * organização podia ser cadastrada**, não só as com ente.
 *
 * MEDIDO NA PRODUÇÃO: a última organização criada é de **11/09/2026 às 22:52**,
 * e o campo entrou na tela em 10/09. **Quinze dias de cadastro morto**, sem um
 * único chamado — porque a mensagem de erro fala de uma propriedade que ninguém
 * da secretaria sabe o que é, e a pessoa conclui que "o sistema não deixou".
 *
 * ESTE BLOCO RODA O PIPE DE VERDADE, com a mesma configuração de `main.ts`,
 * contra o metatipo que a rota declara. Conferir o texto do DTO provaria que a
 * linha existe, não que o corpo passa.
 */
describe('cadastrar organização aceita o corpo que a tela manda', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

  const metatipo = (metodo: 'criar' | 'atualizar', indice: number) =>
    Reflect.getMetadata('design:paramtypes', PartesExternasController.prototype, metodo)[indice];

  /**
   * O QUE A TELA MANDA HOJE — copiado de `organizacoes/page.tsx`, função
   * `salvar()`. Se alguém acrescentar um campo lá e esquecer do DTO, é aqui que
   * o erro aparece, e não na mão da secretaria.
   */
  const DA_TELA = {
    tipo: 'ORGAO_PUBLICO',
    nome: 'MUNICIPIO DE JOSE DE FREITAS',
    nomeFantasia: 'SECRETARIA DE SAUDE',
    documento: '06554786000256',
    cidade: 'JOSE DE FREITAS',
    uf: 'PI',
    enteCodigo: 2205201,
  };

  it('aceita o corpo completo no POST', async () => {
    const saida = await pipe.transform(DA_TELA, {
      type: 'body',
      metatype: metatipo('criar', 0),
      data: '',
    });
    expect(saida.enteCodigo).toBe(2205201);
    expect(saida.nome).toBe('MUNICIPIO DE JOSE DE FREITAS');
  });

  /**
   * E COM `enteCodigo: null`, que é o caso de QUEM NÃO ESCOLHE ENTE — o corpo
   * leva a chave mesmo assim, e era ele que derrubava todo cadastro comum.
   */
  it('aceita o corpo sem ente escolhido (a chave vai como null)', async () => {
    const saida = await pipe.transform(
      { ...DA_TELA, enteCodigo: null },
      { type: 'body', metatype: metatipo('criar', 0), data: '' },
    );
    expect(saida.enteCodigo).toBeNull();
  });

  /** O mesmo corpo tem de passar no PATCH — é literalmente o mesmo objeto. */
  it('o mesmo corpo passa no PATCH', async () => {
    const saida = await pipe.transform(DA_TELA, {
      type: 'body',
      metatype: metatipo('atualizar', 1),
      data: '',
    });
    expect(saida.enteCodigo).toBe(2205201);
  });

  /** E a whitelist continua valendo: o que não é do cadastro não entra. */
  it('continua recusando campo que não é da organização', async () => {
    await expect(
      pipe.transform(
        { ...DA_TELA, ativo: false, qualquerCoisa: 1 },
        { type: 'body', metatype: metatipo('criar', 0), data: '' },
      ),
    ).rejects.toThrow();
  });
});

/**
 * A REGRA QUE ESTAVA IMPLÍCITA E POR ISSO QUEBROU.
 *
 * Uma tela que cria E edita com o mesmo formulário manda o MESMO objeto para as
 * duas rotas. Então os dois DTOs precisam aceitar o mesmo conjunto de campos —
 * o PATCH pode aceitar MAIS (o `ativo`, que só existe depois de a linha nascer),
 * nunca campos que o POST desconheça.
 */
describe('os dois DTOs aceitam o mesmo formulário', () => {
  /**
   * `class-validator` guarda os campos decorados no seu metadata storage. É por
   * ele que se sabe o que cada DTO aceita — instanciar a classe não basta,
   * porque propriedade opcional sem valor não existe no objeto.
   */
  const decorados = (Classe: new () => object): Set<string> => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetadataStorage } = require('class-validator');
    const alvos = getMetadataStorage().getTargetValidationMetadatas(Classe, '', false, false);
    return new Set(alvos.map((m: { propertyName: string }) => m.propertyName));
  };

  it('o PATCH não conhece nenhum campo que o POST desconheça, além de `ativo`', () => {
    const doPost = decorados(CriarParteExternaDto);
    const doPatch = decorados(AtualizarParteExternaDto);
    const soNoPatch = [...doPatch].filter((c) => !doPost.has(c));
    expect(soNoPatch.sort()).toEqual(['ativo']);
  });

  /** E `enteCodigo` está nos dois — foi ele que faltava. */
  it('enteCodigo está nos dois', () => {
    expect(decorados(CriarParteExternaDto).has('enteCodigo')).toBe(true);
    expect(decorados(AtualizarParteExternaDto).has('enteCodigo')).toBe(true);
  });
});

/**
 * E O SERVIÇO GRAVA O QUE O DTO ACEITA.
 *
 * Passar pela validação não basta: `criar` não copiava `enteCodigo` para o
 * `create` do Prisma. A pessoa escolheria "PREFEITURA DE JOSÉ DE FREITAS",
 * salvaria sem erro nenhum, e a organização nasceria SEM ente — direto para a
 * fila do robô, que é o que a escolha à mão existe para evitar.
 */
describe('a criação grava o ente escolhido', () => {
  const fonte = readFileSync(join(__dirname, 'partes-externas.service.ts'), 'utf8')
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const criar = fonte.slice(fonte.indexOf('async criar('), fonte.indexOf('async atualizar('));

  it('copia o ente para o create', () => {
    expect(criar).toContain('enteCodigo: dto.enteCodigo, enteOrigem: OrigemDaLigacao.MANUAL');
  });

  /** Escolha de gente carimba MANUAL — a varredura nunca mais encosta. */
  it('carimba a origem como MANUAL, igual ao update', () => {
    expect(criar).toContain('OrigemDaLigacao.MANUAL');
  });
});
