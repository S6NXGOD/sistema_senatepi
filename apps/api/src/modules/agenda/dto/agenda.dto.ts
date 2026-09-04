import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
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
import { AREAS_JURIDICAS } from '../../processos/areas.catalogo';

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

  @ApiPropertyOptional({
    description:
      'POR QUE é urgente. Obrigatório ao marcar pela tela — urgência sem motivo não ' +
      'pode ser revista depois, e a fila inteira acaba urgente.',
  })
  @IsOptional() @IsString() @MaxLength(300)
  urgenteMotivo?: string;

  @ApiProperty({ description: 'Usuário RESPONSÁVEL (quem responde pela atividade).' })
  @IsString() @IsNotEmpty()
  responsavelId: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'EQUIPE: os demais advogados/colaboradores que atuam nesta atividade. O responsável ' +
      'continua sendo `responsavelId` — pode vir repetido aqui, a API remove. Todos veem a ' +
      'atividade na própria agenda; a conclusão é de quem responde.',
  })
  @IsOptional() @IsArray() @IsString({ each: true })
  responsaveisIds?: string[];

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
export class NovoProcessoPreProcessualDto {
  @ApiPropertyOptional({ description: 'Rótulo do caso (padrão: título da atividade).' })
  @IsOptional() @IsString() @MaxLength(180)
  titulo?: string;

  @ApiPropertyOptional({ description: 'Assunto/objeto da futura ação.' })
  @IsOptional() @IsString() @MaxLength(180)
  assunto?: string;

  @ApiPropertyOptional({
    enum: AREAS_JURIDICAS.map((a) => a.slug),
    description:
      'ÁREA JURÍDICA do caso. É a única classificação que existe antes do ajuizamento — ' +
      'sem NPU não há classe nem assunto do CNJ, e o caso apareceria na lista sem nada.',
  })
  @IsOptional() @IsIn(AREAS_JURIDICAS.map((a) => a.slug))
  categoria?: string;

  @ApiPropertyOptional({ description: 'Advogado RESPONSÁVEL (padrão: o da atividade).' })
  @IsOptional() @IsString()
  advogadoId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Demais advogados da equipe do caso (o responsável entra sozinho).',
  })
  @IsOptional() @IsArray() @IsString({ each: true })
  advogadosIds?: string[];

  @ApiPropertyOptional({ description: 'Observação inicial, registrada como 1º andamento interno.' })
  @IsOptional() @IsString() @MaxLength(5000)
  observacao?: string;
}

/** Nome antigo, mantido para não quebrar quem já importava o tipo. */
export { NovoProcessoPreProcessualDto as NovoProcessoRascunhoDto };

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
    type: NovoProcessoPreProcessualDto,
    description: 'Dados do caso pré-processual — usado em PROCESSO_CRIADO.',
  })
  @IsOptional() @ValidateNested() @Type(() => NovoProcessoPreProcessualDto)
  novoProcesso?: NovoProcessoPreProcessualDto;

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

  /**
   * VÁRIOS ADVOGADOS DE UMA VEZ — "a agenda do Murilo e da Shérad".
   *
   * LISTA SEPARADA POR VÍRGULA, e não `campo[]=a&campo[]=b`: a notação de
   * colchete depende de como o `qs` do Express foi configurado e de como o
   * cliente serializa, e as duas pontas discordarem dá o pior resultado
   * possível — um filtro que a tela mostra ativo e a API ignora, devolvendo a
   * agenda inteira como se fosse a de uma pessoa. A vírgula não tem
   * ambiguidade e cabe na URL que se copia e cola.
   *
   * Convive com `responsavelId` (um só): os dois são somados.
   */
  @ApiPropertyOptional({ description: 'Ids separados por vírgula ("id1,id2").' })
  @IsOptional() @IsString() responsaveis?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() filiadoId?: string;

  /** Só o que está marcado como urgente. */
  @ApiPropertyOptional({ description: '"true" para trazer só as urgentes.' })
  @IsOptional() @IsString() urgente?: string;
  @ApiPropertyOptional({ description: 'Busca por título ou nome do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ description: 'Início do período (ISO/data).' })
  @IsOptional() @IsString() dataInicio?: string;
  @ApiPropertyOptional({ description: 'Fim do período (ISO/data).' })
  @IsOptional() @IsString() dataFim?: string;
}
