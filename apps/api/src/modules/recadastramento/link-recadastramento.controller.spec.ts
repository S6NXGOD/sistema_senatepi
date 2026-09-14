import { BadRequestException, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  LinkRecadastramentoAdminController, RecadastroPublicoController,
} from './link-recadastramento.controller';
import { RespostaDoDesafioDto } from './dto/resposta-do-desafio.dto';

/**
 * AS ROTAS DO LINK QUE MUDARAM EM 14/09/2026, lidas dos metadados que o Nest usa.
 *
 * O pipe é o de verdade, com a configuração de `main.ts`. A varredura geral de
 * colisões mora em `common/rotas-que-colidem.spec.ts` e já cobre a rota nova.
 */

describe('POST /recadastro/:token/validar — o corpo passa pela validação', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const metatipo = () =>
    Reflect.getMetadata('design:paramtypes', RecadastroPublicoController.prototype, 'validar')[1];
  const validar = (corpo: unknown) => pipe.transform(corpo, { type: 'body', metatype: metatipo(), data: '' });

  it('a rota declara a CLASSE, não `Object`', () => {
    expect(metatipo()).toBe(RespostaDoDesafioDto);
  });

  /**
   * O QUE A PÁGINA PÚBLICA ANTIGA MANDA (recadastro/[token]/page.tsx até 14/09):
   * `cpf` só dígitos, `dataNascimento` do campo de data e `coren` — cada um
   * `|| undefined`, que o JSON descarta. O link NENHUM chama sem nada preenchido.
   * Nada disso pode virar 400: é quem abriu o link antes do deploy.
   */
  it.each([
    ['CPF e data', { cpf: '12345678909', dataNascimento: '1980-05-10' }],
    ['só o COREN', { coren: 'PI-123456' }],
    ['os três', { cpf: '12345678909', dataNascimento: '1980-05-10', coren: '123456' }],
    ['vazio (link NENHUM abre sozinho)', {}],
  ])('a página antiga com %s continua passando', async (_nome, corpo) => {
    const r = await validar(corpo);
    expect(r).toBeInstanceOf(RespostaDoDesafioDto);
    expect({ ...r }).toEqual(corpo);
  });

  it('sem corpo nenhum também passa (o serviço recebe objeto vazio)', async () => {
    expect({ ...(await validar(undefined)) }).toEqual({});
  });

  it.each([
    ['campo que não existe', { cpf: '12345678909', situacao: 'ATIVO' }],
    ['matricula (não entrou na rodada)', { matricula: '123456' }],
    ['CPF que não é texto', { cpf: 12345678909 }],
    ['data comprida demais', { dataNascimento: '1980-05-10T03:00:00.000Z-e-mais' }],
    ['COREN comprido demais', { coren: 'X'.repeat(41) }],
  ])('recusa %s com 400', async (_nome, corpo) => {
    await expect(validar(corpo)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GET /filiados/:id/link-recadastramento/previa', () => {
  const proto = LinkRecadastramentoAdminController.prototype;

  it('é GET em "previa", no controller do módulo filiados', () => {
    expect(Reflect.getMetadata(PATH_METADATA, LinkRecadastramentoAdminController)).toBe(
      'filiados/:id/link-recadastramento',
    );
    expect(Reflect.getMetadata(PATH_METADATA, proto.previa)).toBe('previa');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.previa)).toBe(RequestMethod.GET);
  });

  it('vem declarada antes do GET sem caminho (a literal antes da genérica)', () => {
    const metodos = Object.getOwnPropertyNames(proto);
    expect(Reflect.getMetadata(PATH_METADATA, proto.listar)).toBe('/');
    expect(metodos.indexOf('previa')).toBeGreaterThan(-1);
    expect(metodos.indexOf('previa')).toBeLessThan(metodos.indexOf('listar'));
  });

  it('chama a prévia do serviço com o id do filiado', async () => {
    const service = { previa: jest.fn().mockResolvedValue({ desafio: 'CPF', podeGerar: true }) };
    const controller = new LinkRecadastramentoAdminController(service as never);
    await expect(controller.previa('f1')).resolves.toEqual({ desafio: 'CPF', podeGerar: true });
    expect(service.previa).toHaveBeenCalledWith('f1');
  });
});
