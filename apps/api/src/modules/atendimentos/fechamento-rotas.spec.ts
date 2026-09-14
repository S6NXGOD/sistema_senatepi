import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CancelarAtendimentoDto, ConcluirAtendimentoDto, MudarModalidadeConsultaDto,
} from './dto/atendimentos.dto';

/**
 * AS ROTAS DO FECHAMENTO (14/09/2026, D9 da rodada 3) moram no controller de
 * atendimentos, sob a matriz dele: a Triagem conclui e cancela com atendimentos
 * EDITAR, sem precisar de EDITAR na agenda. Se uma rota mudar de casa, a matriz
 * que a governa muda junto; se um `@Roles` entrar, ele atropela a matriz em
 * silêncio (71 usos contados em 12/09). Lido SEM comentários, para não passar
 * por um decorador citado num.
 */
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ler = (arquivo: string) => semComentarios(readFileSync(path.join(__dirname, arquivo), 'utf8'));

describe('as rotas do fechamento', () => {
  const controller = ler('atendimentos.controller.ts');

  it('estão no controller de atendimentos, sob a matriz, sem @Roles', () => {
    expect(controller).toContain("@Modulo('atendimentos')");
    expect(controller).toContain("@Patch(':id/concluir')");
    expect(controller).toContain("@Patch(':id/cancelar')");
    expect(controller).toContain("@Patch(':id/consultas/:compromissoId/modalidade')");
    // A rota antiga do link continua: o web antigo, em cache, ainda a chama.
    expect(controller).toContain("@Patch(':id/consultas/:compromissoId/link')");
    expect(controller).not.toContain('@Roles(');
  });

  it('nenhuma rota PATCH só com parâmetro fica antes delas (nada as engole)', () => {
    expect(controller).not.toMatch(/@Patch\(\s*':id'\s*\)/);
  });

  it('o módulo importa a agenda, e a agenda não importa atendimentos nem escalas (sem ciclo)', () => {
    expect(ler('atendimentos.module.ts')).toMatch(/imports:\s*\[[^\]]*AgendaModule/);
    const agenda = ler('../agenda/agenda.module.ts');
    expect(agenda).not.toContain('AtendimentosModule');
    expect(agenda).not.toContain('EscalasModule');
  });
});

/**
 * OS CORPOS, validados como o ValidationPipe valida (com `forbidNonWhitelisted`
 * no ar): os campos novos são opcionais onde o plano decide, e a categoria é o
 * único obrigatório do cancelar.
 */
describe('os DTOs do fechamento', () => {
  async function erros<T extends object>(classe: new () => T, corpo: Record<string, unknown>) {
    const falhas = await validate(plainToInstance(classe, corpo), { whitelist: true, forbidNonWhitelisted: true });
    return falhas.flatMap((f) => Object.values(f.constraints ?? {}));
  }

  it('concluir aceita o corpo vazio (o "Concluir agora?" do resolvido no ato) e o completo', async () => {
    expect(await erros(ConcluirAtendimentoDto, {})).toEqual([]);
    expect(await erros(ConcluirAtendimentoDto, { nota: 'A filiada resolveu no RH.', consulta: 'CANCELAR' })).toEqual([]);
  });

  it('concluir recusa escolha que não existe, e nota acima de 2000', async () => {
    expect(await erros(ConcluirAtendimentoDto, { consulta: 'ADIAR' })).toHaveLength(1);
    expect(await erros(ConcluirAtendimentoDto, { nota: 'x'.repeat(2001) })).toEqual(['A nota cabe em 2000 caracteres.']);
  });

  it('cancelar exige a categoria, com a frase de gente', async () => {
    expect(await erros(CancelarAtendimentoDto, {})).toEqual(['Diga por que o atendimento vai ser cancelado.']);
    expect(await erros(CancelarAtendimentoDto, { categoria: 'SUBSTITUIDA' })).toEqual(['Diga por que o atendimento vai ser cancelado.']);
    expect(await erros(CancelarAtendimentoDto, { categoria: 'DESISTENCIA', motivo: 'Arranjou advogado próprio.', consulta: 'MANTER' })).toEqual([]);
  });

  it('modalidade: as três fichas, link opcional e nulo para tirar', async () => {
    expect(await erros(MudarModalidadeConsultaDto, { modalidade: 'VIDEO', linkReuniao: 'https://meet.google.com/abc-defg-hij' })).toEqual([]);
    expect(await erros(MudarModalidadeConsultaDto, { modalidade: 'VIDEO', linkReuniao: null })).toEqual([]);
    expect(await erros(MudarModalidadeConsultaDto, { modalidade: 'SEDE' })).toEqual([]);
    expect(await erros(MudarModalidadeConsultaDto, { modalidade: 'PRESENCIAL' })).toEqual(['Modalidade inválida: use SEDE, VIDEO ou TELEFONE.']);
  });
});
