import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { AssuntoAtendimento, CanalAtendimento } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  assuntoGravavel,
  descreverAssunto,
  MENSAGEM_ASSUNTO_OUTRO,
  ROTULO_ASSUNTO,
  ROTULO_CANAL,
} from './assunto.util';
import { AtualizarAssuntoDto, CreateAtendimentoDto } from './dto/atendimentos.dto';

describe('assuntoGravavel — o par (assunto, "qual assunto?") que vai ao banco', () => {
  it('sem assunto: os dois nulos, mesmo que venha texto', () => {
    expect(assuntoGravavel(null, 'aposentadoria')).toEqual({ assunto: null, assuntoOutro: null });
    expect(assuntoGravavel(undefined, undefined)).toEqual({ assunto: null, assuntoOutro: null });
  });

  it('assunto da lista descarta o texto: Outro que virou Remuneração não guarda "aposentadoria"', () => {
    expect(assuntoGravavel(AssuntoAtendimento.REMUNERACAO, 'aposentadoria')).toEqual({
      assunto: AssuntoAtendimento.REMUNERACAO,
      assuntoOutro: null,
    });
  });

  it('Outro guarda o texto limpo, com espaços colapsados', () => {
    expect(assuntoGravavel(AssuntoAtendimento.OUTRO, '  plano   de\tsaúde ')).toEqual({
      assunto: AssuntoAtendimento.OUTRO,
      assuntoOutro: 'plano de saúde',
    });
  });

  it.each([
    ['sem texto', undefined],
    ['nulo', null],
    ['só espaços', '     '],
    ['curto demais depois de limpar', '  ab  '],
    ['81 caracteres', 'a'.repeat(81)],
  ])('Outro recusa texto %s, com a frase de gente', (_nome, texto) => {
    expect(() => assuntoGravavel(AssuntoAtendimento.OUTRO, texto)).toThrow(BadRequestException);
    expect(() => assuntoGravavel(AssuntoAtendimento.OUTRO, texto)).toThrow(MENSAGEM_ASSUNTO_OUTRO);
  });

  it('as bordas de 3 e 80 caracteres passam — 80 é também o teto do VARCHAR', () => {
    expect(assuntoGravavel(AssuntoAtendimento.OUTRO, 'luz').assuntoOutro).toBe('luz');
    expect(assuntoGravavel(AssuntoAtendimento.OUTRO, 'x'.repeat(80)).assuntoOutro).toHaveLength(80);
  });
});

describe('descreverAssunto — a frase da auditoria', () => {
  it('rótulo, Outro com o texto, ou "sem assunto"', () => {
    expect(descreverAssunto(AssuntoAtendimento.REMUNERACAO)).toBe('Remuneração');
    expect(descreverAssunto(AssuntoAtendimento.OUTRO, 'aposentadoria')).toBe('Outro: aposentadoria');
    expect(descreverAssunto(AssuntoAtendimento.OUTRO, null)).toBe('Outro');
    expect(descreverAssunto(null)).toBe('sem assunto');
  });
});

describe('rótulos', () => {
  it('todo valor dos enums tem rótulo, e nenhum é o valor cru', () => {
    for (const v of Object.values(CanalAtendimento)) {
      expect(ROTULO_CANAL[v]).toBeTruthy();
      expect(ROTULO_CANAL[v]).not.toBe(v);
    }
    for (const v of Object.values(AssuntoAtendimento)) {
      expect(ROTULO_ASSUNTO[v]).toBeTruthy();
      expect(ROTULO_ASSUNTO[v]).not.toBe(v);
    }
  });
});

/**
 * A PORTA DA FRENTE — o DTO, validado de verdade pelo class-validator, como o
 * `ValidationPipe` faz. É ele que devolve 400 antes de o texto de 81 caracteres
 * virar erro do Postgres.
 */
describe('DTOs do assunto', () => {
  const erros = async <T extends object>(cls: new () => T, corpo: object) =>
    (await validate(plainToInstance(cls, corpo))).map((e) => e.property);

  const base = { filiadoId: 'f-1', canal: 'PRESENCIAL', descricao: 'Quer saber do reajuste' };

  it('criar com Outro exige "qual assunto?"', async () => {
    expect(await erros(CreateAtendimentoDto, { ...base, assunto: 'OUTRO' })).toContain('assuntoOutro');
    expect(await erros(CreateAtendimentoDto, { ...base, assunto: 'OUTRO', assuntoOutro: 'ab' })).toContain('assuntoOutro');
    expect(await erros(CreateAtendimentoDto, { ...base, assunto: 'OUTRO', assuntoOutro: 'a'.repeat(81) })).toContain('assuntoOutro');
    expect(await erros(CreateAtendimentoDto, { ...base, assunto: 'OUTRO', assuntoOutro: 'aposentadoria' })).toEqual([]);
  });

  it('criar sem assunto, ou com assunto da lista, não pede o texto', async () => {
    expect(await erros(CreateAtendimentoDto, base)).toEqual([]);
    expect(await erros(CreateAtendimentoDto, { ...base, assunto: 'REMUNERACAO' })).toEqual([]);
  });

  it('reclassificar aceita nulo, recusa valor fora da lista e exige a chave', async () => {
    expect(await erros(AtualizarAssuntoDto, { assunto: null })).toEqual([]);
    expect(await erros(AtualizarAssuntoDto, { assunto: 'ADICIONAIS' })).toEqual([]);
    expect(await erros(AtualizarAssuntoDto, { assunto: 'APOSENTADORIA' })).toContain('assunto');
    expect(await erros(AtualizarAssuntoDto, {})).toContain('assunto');
    expect(await erros(AtualizarAssuntoDto, { assunto: 'OUTRO' })).toContain('assuntoOutro');
  });
});
