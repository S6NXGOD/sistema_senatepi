import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty,
  IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AssuntoAtendimento, CanalAtendimento, DesfechoAtendimento, StatusAtendimento, TipoEncaminhamento,
} from '@prisma/client';
import { ASSUNTO_OUTRO_MAX, ASSUNTO_OUTRO_MIN, MENSAGEM_ASSUNTO_OUTRO } from '../assunto.util';
import { MODALIDADES_CONSULTA, ModalidadeConsulta, modalidadeRemota } from '../encaminhamento.util';
import {
  CATEGORIAS_CANCELAMENTO_ATENDIMENTO, CategoriaCancelamentoAtendimento, ESCOLHAS_DA_CONSULTA,
  EscolhaDaConsulta, MOTIVO_MAXIMO, NOTA_MAXIMA,
} from '../fechamento.util';

/** Criação: só o essencial da triagem — o desfecho é registrado depois. */
export class CreateAtendimentoDto {
  @ApiProperty({ description: 'Filiado ao qual o atendimento pertence.' })
  @IsString() @IsNotEmpty()
  filiadoId: string;

  @ApiProperty({ enum: CanalAtendimento })
  @IsEnum(CanalAtendimento)
  canal: CanalAtendimento;

  /**
   * SOBRE O QUE É A DEMANDA.
   *
   * O atendimento sabia COMO a pessoa chegou, QUEM atendeu e COMO terminou — e
   * não sabia sobre o quê. "As pessoas vêm mais por nível ou por salário?" não
   * tinha resposta, e a descrição livre dos registros existentes confirma:
   * cinco dos sete dizem apenas "Consulta Jurídica".
   *
   * OPCIONAL de propósito. Obrigar a classificar no balcão, com o filiado
   * esperando, produz o primeiro item da lista em toda ficha — e um campo
   * preenchido no automático mente pior que um campo vazio. O relatório conta
   * os não informados à parte.
   */
  @ApiPropertyOptional({ enum: AssuntoAtendimento, description: 'Assunto da demanda.' })
  @IsOptional() @IsEnum(AssuntoAtendimento) assunto?: AssuntoAtendimento;

  /**
   * "QUAL ASSUNTO?" — obrigatório só quando se escolheu Outro (decisão D12).
   * Quem escolheu Outro já decidiu classificar, e três palavras não travam o
   * balcão. Nos demais assuntos o texto é ignorado e grava nulo
   * (`assuntoGravavel`).
   */
  @ApiPropertyOptional({ description: 'Qual é o assunto, quando assunto = OUTRO (3 a 80 caracteres).' })
  @ValidateIf((o) => o.assunto === AssuntoAtendimento.OUTRO)
  @IsString({ message: MENSAGEM_ASSUNTO_OUTRO })
  @MinLength(ASSUNTO_OUTRO_MIN, { message: MENSAGEM_ASSUNTO_OUTRO })
  @MaxLength(ASSUNTO_OUTRO_MAX, { message: MENSAGEM_ASSUNTO_OUTRO })
  assuntoOutro?: string;

  @ApiProperty({ description: 'Descrição da demanda.' })
  @IsString() @MinLength(3, { message: 'Descreva a demanda.' })
  descricao: string;

  /**
   * A TRIAGEM É A PORTA: é no balcão que se descobre que o caso tem prazo curto.
   * Era o único dos três lugares (triagem, agenda, processo) sem como registrar
   * isso — a informação existia na cabeça de quem atendeu e morria ali.
   * A urgência marcada aqui é HERDADA pela atividade e pelo caso que nascerem
   * desta demanda.
   */
  @ApiPropertyOptional({ description: 'Marca a demanda como urgente.' })
  @IsOptional() @IsBoolean() urgente?: boolean;

  @ApiPropertyOptional({ description: 'POR QUE é urgente — obrigatório ao marcar.' })
  @IsOptional() @IsString() @MaxLength(300) urgenteMotivo?: string;
}

/** Registro do desfecho (resultado) da triagem. */
export class RegistrarDesfechoDto {
  @ApiProperty({ enum: DesfechoAtendimento })
  @IsEnum(DesfechoAtendimento)
  resultado: DesfechoAtendimento;

  @ApiPropertyOptional({ description: 'O que foi resolvido (RESOLVIDO_ATO) ou nota.' })
  @IsOptional() @IsString()
  desfechoObs?: string;

  // ---- Só quando ENCAMINHADO ----
  @ApiPropertyOptional({ type: [String], description: 'Advogado(s) responsável(is).' })
  @ValidateIf((o) => o.resultado === DesfechoAtendimento.ENCAMINHADO)
  @IsArray() @ArrayNotEmpty({ message: 'Selecione ao menos um advogado.' }) @IsString({ each: true })
  advogadoIds?: string[];

  @ApiPropertyOptional({ enum: TipoEncaminhamento })
  @ValidateIf((o) => o.resultado === DesfechoAtendimento.ENCAMINHADO)
  @IsEnum(TipoEncaminhamento, { message: 'Informe o tipo de encaminhamento.' })
  tipoEncaminhamento?: TipoEncaminhamento;

  @ApiPropertyOptional({ description: 'Processo vinculado (obrigatório em ANDAMENTO_PROCESSO).' })
  @ValidateIf((o) => o.tipoEncaminhamento === TipoEncaminhamento.ANDAMENTO_PROCESSO)
  @IsString() @IsNotEmpty({ message: 'Selecione o processo existente.' })
  processoId?: string;

  /**
   * Data e hora da consulta (ISO). Vazia, a consulta vai para as 9h do próximo
   * dia útil (`inicioPadraoDaConsulta`) — MENOS quando é remota: chamada de
   * vídeo ou telefonema é hora combinada com o filiado, e um horário inventado
   * pelo sistema deixaria os dois esperando em horas diferentes.
   */
  @ApiPropertyOptional({ description: 'Data/hora da consulta (ISO). Vazio: próximo dia útil às 9h. Obrigatória por vídeo ou telefone.' })
  @ValidateIf((o) => modalidadeRemota(o.modalidade) || (o.dataConsulta !== undefined && o.dataConsulta !== null))
  @IsNotEmpty({ message: 'Consulta por vídeo ou por telefone precisa de dia e hora combinados.' })
  @IsDateString({}, { message: 'Data da consulta inválida.' })
  dataConsulta?: string;

  /** Como vai ser a consulta. Vai para o `local` da atividade; ver `LOCAL_DA_MODALIDADE`. */
  @ApiPropertyOptional({ enum: MODALIDADES_CONSULTA, description: 'Na sede, por vídeo ou por telefone.' })
  @IsOptional()
  @IsIn(MODALIDADES_CONSULTA, { message: 'Modalidade inválida: use SEDE, VIDEO ou TELEFONE.' })
  modalidade?: ModalidadeConsulta;

  /**
   * Link da chamada, quando por vídeo. Aceita o convite colado inteiro — a
   * normalização extrai a primeira URL; o teto de 500 vale para a URL, e este
   * teto maior só impede que um texto enorme chegue ao serviço.
   */
  @ApiPropertyOptional({ description: 'Link da chamada (Meet, Zoom, Teams…), só para consulta por vídeo.' })
  @IsOptional() @IsString() @MaxLength(2000)
  linkReuniao?: string | null;
}

/** Reclassificar o assunto depois — no balcão, na gaveta ou no desfecho. */
export class AtualizarAssuntoDto {
  /** `null` é "sem assunto": desfazer uma classificação errada também é classificar. */
  @ApiProperty({ enum: AssuntoAtendimento, nullable: true })
  @ValidateIf((o) => o.assunto !== null)
  @IsEnum(AssuntoAtendimento, { message: 'Escolha um assunto da lista (ou envie nulo para deixar sem assunto).' })
  assunto: AssuntoAtendimento | null;

  @ApiPropertyOptional({ description: 'Qual é o assunto, quando assunto = OUTRO (3 a 80 caracteres).' })
  @ValidateIf((o) => o.assunto === AssuntoAtendimento.OUTRO)
  @IsString({ message: MENSAGEM_ASSUNTO_OUTRO })
  @MinLength(ASSUNTO_OUTRO_MIN, { message: MENSAGEM_ASSUNTO_OUTRO })
  @MaxLength(ASSUNTO_OUTRO_MAX, { message: MENSAGEM_ASSUNTO_OUTRO })
  assuntoOutro?: string;
}

/** Colar (ou tirar) o link da chamada numa consulta nascida do atendimento. */
export class AtualizarLinkConsultaDto {
  @ApiProperty({ nullable: true, description: 'Link da chamada, ou nulo para tirar.' })
  @ValidateIf((o) => o.linkReuniao !== null)
  @IsString({ message: 'Cole o link da chamada, ou envie nulo para tirar.' })
  @MaxLength(2000)
  linkReuniao: string | null;
}

export class EncaminhamentoOpcoesQueryDto {
  @ApiPropertyOptional({ description: 'Dia da consulta (YYYY-MM-DD). Vazio: o dia padrão da consulta.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data inválida: use AAAA-MM-DD.' })
  data?: string;
}

/**
 * Só o REABRIR (PENDENTE) passa por aqui desde 14/09/2026. O enum continua
 * inteiro de propósito: o web antigo, em cache, ainda manda CONCLUIDO e
 * CANCELADO, e é o SERVIÇO que responde "Concluir e cancelar agora têm tela
 * própria" — uma frase que diz o que fazer, e não "status inválido".
 */
export class MudarStatusAtendimentoDto {
  @ApiProperty({ enum: StatusAtendimento })
  @IsEnum(StatusAtendimento)
  status: StatusAtendimento;
}

/**
 * CONCLUIR, com o que a tela perguntou (D9 da rodada 3). Os dois campos são
 * opcionais porque o plano (`planoDeFechamento`) decide quando cada um é
 * exigido; o DTO só barra o que nunca vale.
 */
export class ConcluirAtendimentoDto {
  @ApiPropertyOptional({ description: 'Como a demanda terminou. Obrigatória quando nenhum outro registro diz (ver o plano).' })
  @IsOptional() @IsString() @MaxLength(NOTA_MAXIMA, { message: `A nota cabe em ${NOTA_MAXIMA} caracteres.` })
  nota?: string;

  @ApiPropertyOptional({ enum: ESCOLHAS_DA_CONSULTA, description: 'O que fazer com a consulta marcada, quando o plano pergunta.' })
  @IsOptional()
  @IsIn(ESCOLHAS_DA_CONSULTA, { message: 'Diga se a consulta fica (MANTER) ou sai (CANCELAR).' })
  consulta?: EscolhaDaConsulta;
}

/**
 * CANCELAR: o motivo obrigatório é a CATEGORIA, não o texto livre — o que a
 * agenda aprendeu no cancelamento dela, e o que vira estatística depois.
 */
export class CancelarAtendimentoDto {
  @ApiProperty({ enum: CATEGORIAS_CANCELAMENTO_ATENDIMENTO })
  @IsIn(CATEGORIAS_CANCELAMENTO_ATENDIMENTO, { message: 'Diga por que o atendimento vai ser cancelado.' })
  categoria: CategoriaCancelamentoAtendimento;

  @ApiPropertyOptional({ description: 'Detalhe opcional.' })
  @IsOptional() @IsString() @MaxLength(MOTIVO_MAXIMO, { message: `O detalhe cabe em ${MOTIVO_MAXIMO} caracteres.` })
  motivo?: string;

  @ApiPropertyOptional({ enum: ESCOLHAS_DA_CONSULTA, description: 'O que fazer com a consulta marcada, quando o plano pergunta.' })
  @IsOptional()
  @IsIn(ESCOLHAS_DA_CONSULTA, { message: 'Diga se a consulta fica (MANTER) ou sai (CANCELAR).' })
  consulta?: EscolhaDaConsulta;
}

/** "Mudar como vai ser" a consulta já marcada: a modalidade e, no vídeo, o link. */
export class MudarModalidadeConsultaDto {
  @ApiProperty({ enum: MODALIDADES_CONSULTA })
  @IsIn(MODALIDADES_CONSULTA, { message: 'Modalidade inválida: use SEDE, VIDEO ou TELEFONE.' })
  modalidade: ModalidadeConsulta;

  /** Só com VIDEO. Ausente no vídeo mantém o link que já existe; nulo tira. */
  @ApiPropertyOptional({ nullable: true, description: 'Link da chamada (só por vídeo), ou nulo para tirar.' })
  @IsOptional()
  @ValidateIf((o) => o.linkReuniao != null)
  @IsString({ message: 'Cole o link da chamada, ou envie nulo para tirar.' })
  @MaxLength(2000)
  linkReuniao?: string | null;
}

export class ListAtendimentosQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome, matrícula ou CPF do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ enum: DesfechoAtendimento })
  @IsOptional() @IsEnum(DesfechoAtendimento) desfecho?: DesfechoAtendimento;

  @ApiPropertyOptional({ enum: StatusAtendimento })
  @IsOptional() @IsEnum(StatusAtendimento) status?: StatusAtendimento;

  @ApiPropertyOptional({ enum: CanalAtendimento })
  @IsOptional() @IsEnum(CanalAtendimento) canal?: CanalAtendimento;

  @ApiPropertyOptional({ enum: AssuntoAtendimento })
  @IsOptional() @IsEnum(AssuntoAtendimento) assunto?: AssuntoAtendimento;

  @ApiPropertyOptional({ description: 'Data inicial (YYYY-MM-DD).' })
  @IsOptional() @IsString() dataInicio?: string;
  @ApiPropertyOptional({ description: 'Data final (YYYY-MM-DD).' })
  @IsOptional() @IsString() dataFim?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
