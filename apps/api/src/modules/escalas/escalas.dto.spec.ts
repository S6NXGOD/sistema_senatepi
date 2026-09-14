import { ValidationPipe } from '@nestjs/common';
import {
  AtualizarEscalaDto, ConsultasDoPlantaoQueryDto, CopiaQueryDto, CopiarEscalaDto, CriarEscalasDto, ListEscalasQueryDto,
} from './dto/escalas.dto';

/**
 * O DTO COM O `ValidationPipe` DE VERDADE — o mesmo de `main.ts`.
 *
 * `IsDateString` aceitava "2026-09-15T23:00:00-03:00", que vira 16/09 em UTC:
 * a escala andava um dia. O lote não tinha teto e a observação não tinha
 * tamanho. E, com `forbidNonWhitelisted`, um campo que o DTO não declara vira
 * 400 — o PATCH não pode aceitar `data` (plantão em outro dia é outro plantão).
 */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

async function valida(metatype: new () => object, valor: unknown, type: 'body' | 'query' = 'body') {
  try {
    await pipe.transform(valor, { type, metatype });
    return 'ok';
  } catch (e: any) {
    return ([] as string[]).concat(e.getResponse().message).join(' | ');
  }
}

const item = { data: '2026-09-15', horaInicio: '09:00', horaFim: '12:00' };

describe('CriarEscalasDto', () => {
  it('aceita o lote normal', async () => {
    expect(await valida(CriarEscalasDto, { advogadoId: 'u1', itens: [item] })).toBe('ok');
  });

  it('recusa data com hora ou fuso', async () => {
    expect(
      await valida(CriarEscalasDto, { advogadoId: 'u1', itens: [{ ...item, data: '2026-09-15T23:00:00-03:00' }] }),
    ).toContain('Data inválida (use AAAA-MM-DD).');
  });

  it('recusa mais de 62 datas de uma vez', async () => {
    const itens = Array.from({ length: 63 }, () => item);
    expect(await valida(CriarEscalasDto, { advogadoId: 'u1', itens })).toContain('No máximo 62 datas por vez.');
    expect(await valida(CriarEscalasDto, { advogadoId: 'u1', itens: itens.slice(0, 62) })).toBe('ok');
  });

  it('recusa observação longa demais e hora fora do formato', async () => {
    expect(
      await valida(CriarEscalasDto, { advogadoId: 'u1', itens: [{ ...item, observacao: 'x'.repeat(501) }] }),
    ).toContain('A observação passa de 500 caracteres.');
    expect(
      await valida(CriarEscalasDto, { advogadoId: 'u1', itens: [{ ...item, horaInicio: '9:00' }] }),
    ).toContain('Hora de início inválida (use HH:MM).');
  });
});

describe('AtualizarEscalaDto', () => {
  it('aceita troca, horário e observação nula', async () => {
    expect(await valida(AtualizarEscalaDto, { advogadoId: 'u2' })).toBe('ok');
    expect(await valida(AtualizarEscalaDto, { horaInicio: '10:00', horaFim: '12:00' })).toBe('ok');
    expect(await valida(AtualizarEscalaDto, { observacao: null })).toBe('ok');
  });

  it('não aceita mudar a data', async () => {
    expect(await valida(AtualizarEscalaDto, { data: '2026-09-16' })).toContain('property data should not exist');
  });

  it('não aceita pessoa vazia', async () => {
    expect(await valida(AtualizarEscalaDto, { advogadoId: '' })).not.toBe('ok');
  });
});

/**
 * OS CAMPOS NOVOS DE 14/09/2026 (D15 e D16). `passarConsultas` é opcional: a
 * tela antiga não o manda e continua passando no `forbidNonWhitelisted`.
 */
describe('AtualizarEscalaDto.passarConsultas', () => {
  const uuid = '3f2a9c1e-5b7d-4e2f-9a1b-0c8d7e6f5a4b';

  it('ausente, vazio ou com ids de consulta', async () => {
    expect(await valida(AtualizarEscalaDto, { advogadoId: 'u2' })).toBe('ok');
    expect(await valida(AtualizarEscalaDto, { advogadoId: 'u2', passarConsultas: [] })).toBe('ok');
    expect(await valida(AtualizarEscalaDto, { advogadoId: 'u2', passarConsultas: [uuid] })).toBe('ok');
  });

  it('recusa id que não é de consulta e lista acima de 50', async () => {
    expect(await valida(AtualizarEscalaDto, { advogadoId: 'u2', passarConsultas: ['c1'] })).toContain('Consulta inválida.');
    const muitas = Array.from({ length: 51 }, () => uuid);
    expect(await valida(AtualizarEscalaDto, { advogadoId: 'u2', passarConsultas: muitas }))
      .toContain('No máximo 50 consultas por troca.');
    expect(await valida(AtualizarEscalaDto, { advogadoId: 'u2', passarConsultas: 'c1' })).not.toBe('ok');
  });
});

describe('CopiaQueryDto e CopiarEscalaDto', () => {
  const item = { origemId: 'e-07-09', data: '2026-10-05' };

  it('prévia: dois meses AAAA-MM', async () => {
    expect(await valida(CopiaQueryDto, { origem: '2026-09', destino: '2026-10' }, 'query')).toBe('ok');
    expect(await valida(CopiaQueryDto, { origem: '2026-9', destino: '2026-10' }, 'query'))
      .toContain('Mês de origem inválido (use AAAA-MM).');
    expect(await valida(CopiaQueryDto, { origem: '2026-09', destino: '2026-13' }, 'query'))
      .toContain('Mês de destino inválido (use AAAA-MM).');
  });

  it('gravação: ao menos um item, no máximo 250, dia puro', async () => {
    expect(await valida(CopiarEscalaDto, { origem: '2026-09', destino: '2026-10', itens: [item] })).toBe('ok');
    expect(await valida(CopiarEscalaDto, { origem: '2026-09', destino: '2026-10', itens: [] }))
      .toContain('Marque ao menos um plantão para copiar.');
    expect(await valida(CopiarEscalaDto, { origem: '2026-09', destino: '2026-10', itens: Array.from({ length: 251 }, () => item) }))
      .toContain('No máximo 250 plantões por cópia.');
    expect(await valida(CopiarEscalaDto, { origem: '2026-09', destino: '2026-10', itens: [{ ...item, data: '2026-10-05T09:00:00Z' }] }))
      .toContain('Data inválida (use AAAA-MM-DD).');
  });

  it('a observação não viaja na cópia', async () => {
    expect(await valida(CopiarEscalaDto, { origem: '2026-09', destino: '2026-10', itens: [{ ...item, observacao: 'x' }] }))
      .toContain('property observacao should not exist');
  });
});

describe('ConsultasDoPlantaoQueryDto', () => {
  it('`entra` é opcional e nada mais é aceito', async () => {
    expect(await valida(ConsultasDoPlantaoQueryDto, {}, 'query')).toBe('ok');
    expect(await valida(ConsultasDoPlantaoQueryDto, { entra: 'murilo' }, 'query')).toBe('ok');
    expect(await valida(ConsultasDoPlantaoQueryDto, { entra: 'murilo', sai: 'sherad' }, 'query'))
      .toContain('property sai should not exist');
  });
});

describe('ListEscalasQueryDto', () => {
  it('mês AAAA-MM', async () => {
    expect(await valida(ListEscalasQueryDto, { mes: '2026-09' }, 'query')).toBe('ok');
    expect(await valida(ListEscalasQueryDto, {}, 'query')).toBe('ok');
    expect(await valida(ListEscalasQueryDto, { mes: '2026-13' }, 'query')).toContain('Mês inválido (use AAAA-MM).');
  });
});
