import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StatusCompromisso } from '@prisma/client';

export class CreateCompromissoDto {
  @ApiProperty() @IsString() @MinLength(2, { message: 'Informe um título.' })
  titulo: string;

  @ApiProperty({ description: 'Slug do tipo de evento (cadastrável).' })
  @IsString() @IsNotEmpty()
  tipo: string;

  @ApiPropertyOptional({ enum: StatusCompromisso })
  @IsOptional() @IsEnum(StatusCompromisso)
  status?: StatusCompromisso;

  @ApiProperty({ description: 'Início (ISO 8601).' })
  @IsDateString()
  inicio: string;

  @ApiProperty({ description: 'Fim (ISO 8601).' })
  @IsDateString()
  fim: string;

  @ApiPropertyOptional({ description: 'Local (ex.: 1ª Vara do Trabalho de Teresina).' })
  @IsOptional() @IsString()
  local?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  descricao?: string;

  @ApiPropertyOptional({ description: 'Notas internas — não visíveis ao filiado.' })
  @IsOptional() @IsString()
  observacoesInternas?: string;

  @ApiPropertyOptional({ description: 'Marca o compromisso como urgente.' })
  @IsOptional() @IsBoolean()
  urgente?: boolean;

  @ApiProperty({ description: 'Usuário responsável (advogado/colaborador).' })
  @IsString() @IsNotEmpty()
  responsavelId: string;

  @ApiPropertyOptional({ description: 'Filiado vinculado (rastreabilidade).' })
  @IsOptional() @IsString()
  filiadoId?: string;

  @ApiPropertyOptional({ description: 'Atendimento/triagem de origem (rastreabilidade).' })
  @IsOptional() @IsString()
  atendimentoId?: string;

  @ApiPropertyOptional({ description: 'Processo vinculado (DATAJUD).' })
  @IsOptional() @IsString()
  processoId?: string;
}

export class UpdateCompromissoDto extends PartialType(CreateCompromissoDto) {}

/**
 * Mudança de status "simples" — só para os passos que não exigem informação
 * extra (iniciar, voltar a pendente, reabrir). CONCLUIR e CANCELAR têm rotas
 * próprias porque carregam dados obrigatórios (desfecho / motivo).
 */
export class MudarStatusDto {
  @ApiProperty({ enum: StatusCompromisso })
  @IsEnum(StatusCompromisso)
  status: StatusCompromisso;
}

/**
 * Conclusão da atividade: o RESULTADO é obrigatório.
 *
 * Antes bastava um clique e o evento sumia do quadro sem dizer o que aconteceu
 * com a demanda do filiado. Agora a conclusão fecha o ciclo: ou a dúvida foi
 * esclarecida (com o comentário), ou a demanda virou/pertence a um processo.
 */
/**
 * Rascunho de processo criado a partir do desfecho. Tudo é opcional de
 * propósito: neste momento o atendente sabe pouco, e exigir NPU/classe
 * empurraria a equipe a inventar dado. O advogado formaliza depois, no módulo
 * de Processos — informando o número e puxando do DataJud, ou preenchendo à mão.
 */
export class NovoProcessoRascunhoDto {
  @ApiPropertyOptional({ description: 'Rótulo do rascunho (padrão: título da atividade).' })
  @IsOptional() @IsString() @MaxLength(180)
  titulo?: string;

  @ApiPropertyOptional({ description: 'Assunto/objeto da futura ação.' })
  @IsOptional() @IsString() @MaxLength(180)
  assunto?: string;

  @ApiPropertyOptional({ description: 'Advogado responsável (padrão: o da atividade).' })
  @IsOptional() @IsString()
  advogadoId?: string;

  @ApiPropertyOptional({ description: 'Observação inicial, registrada como 1º andamento interno.' })
  @IsOptional() @IsString() @MaxLength(5000)
  observacao?: string;
}

/**
 * Atividade de seguimento criada junto com a conclusão.
 *
 * É o que impede um encaminhamento de virar texto solto: a pendência declarada
 * no desfecho ("com encaminhamentos", "laudo pendente", "prazo perdido") nasce
 * como atividade nova, com responsável e data. Tudo opcional — o catálogo já
 * sugere tipo, título e prazo; aqui só vem o que o usuário mudou.
 */
export class SeguimentoDto {
  @ApiPropertyOptional({ description: 'Título da atividade nova (padrão: o sugerido pelo desfecho).' })
  @IsOptional() @IsString() @MaxLength(180)
  titulo?: string;

  @ApiPropertyOptional({ description: 'Responsável (padrão: o da atividade concluída).' })
  @IsOptional() @IsString()
  responsavelId?: string;

  @ApiPropertyOptional({ description: 'Início (ISO 8601). Padrão: hoje + o prazo sugerido pelo desfecho.' })
  @IsOptional() @IsDateString()
  inicio?: string;

  @ApiPropertyOptional({ description: 'Instrução para quem vai executar (padrão: a observação do desfecho).' })
  @IsOptional() @IsString() @MaxLength(5000)
  descricao?: string;
}

export class ConcluirCompromissoDto {
  @ApiProperty({ description: 'Slug do desfecho — depende do TIPO da atividade (GET /agenda/desfechos/:tipo).' })
  @IsString()
  desfecho: string;

  @ApiPropertyOptional({
    description:
      'Comentário do desfecho. Obrigatório nos desfechos em que o texto É a informação (ex.: orientação dada, termos do acordo, motivo do prazo perdido).',
  })
  @IsOptional() @IsString() @MaxLength(5000)
  desfechoObs?: string;

  @ApiPropertyOptional({ description: 'Processo existente — obrigatório em VINCULADO_PROCESSO.' })
  @IsOptional() @IsString()
  processoId?: string;

  @ApiPropertyOptional({
    type: NovoProcessoRascunhoDto,
    description: 'Dados do rascunho — usado em PROCESSO_CRIADO.',
  })
  @IsOptional() @ValidateNested() @Type(() => NovoProcessoRascunhoDto)
  novoProcesso?: NovoProcessoRascunhoDto;

  @ApiPropertyOptional({
    type: SeguimentoDto,
    description:
      'Atividade de seguimento — usado nos desfechos com ação CRIAR_ATIVIDADE. ' +
      'Onde o seguimento é obrigatório, omitir este campo apenas aceita os padrões do catálogo; ' +
      'para NÃO criar a atividade num desfecho de seguimento sugerido, envie `criarSeguimento: false`.',
  })
  @IsOptional() @ValidateNested() @Type(() => SeguimentoDto)
  seguimento?: SeguimentoDto;

  @ApiPropertyOptional({
    description:
      'Dispensa a atividade de seguimento SUGERIDA (ex.: acordo já cumprido na audiência). ' +
      'Ignorado quando o desfecho marca o seguimento como obrigatório.',
  })
  @IsOptional() @IsBoolean()
  criarSeguimento?: boolean;
}

/**
 * Cancelamento — a CATEGORIA é obrigatória, o texto não.
 *
 * "Cancelado" sozinho não explica nada a quem abre o evento semanas depois, mas
 * quem carrega essa explicação é a categoria: ela responde a pergunta ("filiado
 * não compareceu"), é padronizada e é a única que pode virar estatística. Exigir
 * texto por cima disso só produzia frases que repetem o rótulo escolhido —
 * atrito para a equipe e nenhum dado a mais. O campo continua existindo para o
 * caso que a categoria não cobre.
 */
export class CancelarCompromissoDto {
  @ApiProperty({
    description:
      'Categoria do cancelamento (NAO_COMPARECEU, DESISTENCIA, ADIADA_JUIZO…). ' +
      'É o que permite medir por que as atividades não acontecem.',
  })
  @IsString() @IsNotEmpty({ message: 'Informe por que a atividade não aconteceu.' })
  categoria: string;

  @ApiPropertyOptional({ description: 'Detalhe livre, quando a categoria não basta.' })
  @IsOptional() @IsString() @MaxLength(1000)
  motivo?: string;
}

/**
 * Remarcação — ação própria, não uma edição do evento inteiro.
 * Só mexe em data/hora e guarda o porquê; título, responsável e vínculos ficam
 * de fora para que remarcar seja um gesto rápido e auditável.
 */
export class RemarcarCompromissoDto {
  @ApiProperty({ description: 'Novo início (ISO 8601).' })
  @IsDateString()
  inicio: string;

  @ApiPropertyOptional({
    description: 'Novo fim (ISO 8601). Omitido, preserva a duração original.',
  })
  @IsOptional() @IsDateString()
  fim?: string;

  @ApiPropertyOptional({ description: 'Motivo da remarcação (vai para a auditoria).' })
  @IsOptional() @IsString() @MaxLength(500)
  motivo?: string;
}

export class ListCompromissosQueryDto {
  @ApiPropertyOptional({ enum: StatusCompromisso })
  @IsOptional() @IsEnum(StatusCompromisso) status?: StatusCompromisso;

  @ApiPropertyOptional({ description: 'Slug do tipo de evento.' })
  @IsOptional() @IsString() tipo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() responsavelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() filiadoId?: string;
  @ApiPropertyOptional({ description: 'Busca por título ou nome do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ description: 'Início do período (ISO/data).' })
  @IsOptional() @IsString() dataInicio?: string;
  @ApiPropertyOptional({ description: 'Fim do período (ISO/data).' })
  @IsOptional() @IsString() dataFim?: string;
}
