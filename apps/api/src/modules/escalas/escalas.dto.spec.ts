import { ValidationPipe } from '@nestjs/common';
import { AtualizarEscalaDto, CriarEscalasDto, ListEscalasQueryDto } from './dto/escalas.dto';

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

describe('ListEscalasQueryDto', () => {
  it('mês AAAA-MM', async () => {
    expect(await valida(ListEscalasQueryDto, { mes: '2026-09' }, 'query')).toBe('ok');
    expect(await valida(ListEscalasQueryDto, {}, 'query')).toBe('ok');
    expect(await valida(ListEscalasQueryDto, { mes: '2026-13' }, 'query')).toContain('Mês inválido (use AAAA-MM).');
  });
});
