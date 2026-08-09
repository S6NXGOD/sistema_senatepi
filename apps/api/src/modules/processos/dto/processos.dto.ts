import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StatusProcesso } from '@prisma/client';
import { FaseProcessual } from '../utils/fase.util';

/**
 * Parte contrária informada já na importação. Existe porque o DataJud NÃO
 * devolve as partes (a API Pública do CNJ só expõe metadados processuais), e o
 * momento em que o operador tem o nome do réu em mãos é justamente este.
 */
export class ParteContrariaImportDto {
  @ApiPropertyOptional({ description: 'Id de uma parte já cadastrada (empresa, município…).' })
  @IsOptional() @IsString()
  parteExternaId?: string;

  @ApiPropertyOptional({ description: 'Nome do réu, quando não houver cadastro.' })
  @IsOptional() @IsString() @MaxLength(180)
  nome?: string;

  @ApiPropertyOptional({ description: 'CPF/CNPJ do réu.' })
  @IsOptional() @IsString()
  documento?: string;
}

/**
 * Quem está no POLO ATIVO do processo. Três caminhos, e nenhum deles cria
 * cadastro provisório de filiado:
 *
 *  • INSTITUCIONAL — ação coletiva do sindicato em nome da categoria. O polo
 *    ativo é o próprio sindicato (a ParteExterna marcada `institucional`), e o
 *    processo é gravado como INSTITUCIONAL.
 *  • FILIADOS — um ou MAIS filiados já cadastrados. O primeiro vira a parte
 *    principal e o atalho `Processo.filiadoId`; os demais entram como partes do
 *    mesmo polo (litisconsórcio ativo).
 *  • OUTRA — a parte é conhecida só pelo nome, ou nem isso ("definir depois").
 *    Grava a parte pelo nome, SEM tocar na tabela de Filiados. Omitir o nome é
 *    válido: o processo nasce sem polo ativo e entra na fila de pendências.
 */
export class PoloAtivoImportDto {
  @ApiProperty({ enum: ['INSTITUCIONAL', 'FILIADOS', 'OUTRA'] })
  @IsIn(['INSTITUCIONAL', 'FILIADOS', 'OUTRA'], {
    message: 'Polo ativo inválido — use INSTITUCIONAL, FILIADOS ou OUTRA.',
  })
  tipo: 'INSTITUCIONAL' | 'FILIADOS' | 'OUTRA';

  @ApiPropertyOptional({
    type: [String],
    description: 'Ids dos filiados (obrigatório e não-vazio quando tipo=FILIADOS).',
  })
  @IsOptional() @IsArray() @IsString({ each: true })
  filiadoIds?: string[];

  @ApiPropertyOptional({ description: 'Nome da parte, quando tipo=OUTRA e ela já é conhecida.' })
  @IsOptional() @IsString() @MaxLength(180)
  nome?: string;

  @ApiPropertyOptional({ description: 'CPF/CNPJ da parte, quando tipo=OUTRA.' })
  @IsOptional() @IsString()
  documento?: string;
}

export class ImportarProcessoDto {
  @ApiProperty({ description: 'Número único (NPU/CNJ) — com ou sem pontuação.' })
  @IsString() @IsNotEmpty()
  numeroCNJ: string;

  @ApiPropertyOptional({
    description:
      'Sigla do tribunal (ex.: TJPI, TRT22, TRF1). Opcional — quando omitida é derivada do próprio NPU.',
  })
  @IsOptional() @IsString()
  tribunal?: string;

  @ApiPropertyOptional({
    description:
      'Filiado vinculado. MANTIDO por compatibilidade — o caminho novo é `poloAtivo`, ' +
      'que aceita vários filiados e a ação institucional. Quando ambos vêm, `poloAtivo` vence.',
  })
  @IsOptional() @IsString()
  filiadoId?: string;

  @ApiPropertyOptional({
    type: PoloAtivoImportDto,
    description: 'Quem move a ação: o sindicato, filiados ou outra parte.',
  })
  // `@ValidateNested` é o que faz o objeto aninhado ser realmente checado —
  // sem ele, `@IsObject` aceita qualquer coisa e um `tipo` inválido escorregaria
  // até o serviço, onde cairia no ramo errado em silêncio.
  @IsOptional() @IsObject() @ValidateNested() @Type(() => PoloAtivoImportDto)
  poloAtivo?: PoloAtivoImportDto;

  @ApiPropertyOptional({ type: [String], description: 'Etiquetas internas (Urgente, Coletiva…).' })
  @IsOptional() @IsArray() @IsString({ each: true })
  etiquetas?: string[];

  @ApiPropertyOptional({
    description:
      'Advogado RESPONSÁVEL (o principal). Para uma equipe, use também `advogadosIds`.',
  })
  @IsOptional() @IsString()
  advogadoId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Equipe completa de advogados do processo. `advogadoId` continua sendo o responsável; ' +
      'se ele não estiver nesta lista, é acrescentado. A equipe também pode ser ajustada ' +
      'depois, na aba Partes do processo.',
  })
  @IsOptional() @IsArray() @IsString({ each: true })
  advogadosIds?: string[];

  @ApiPropertyOptional({
    type: ParteContrariaImportDto,
    description: 'Réu/parte contrária — o DataJud não devolve isso, então é informado aqui.',
  })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ParteContrariaImportDto)
  parteContraria?: ParteContrariaImportDto;

  @ApiPropertyOptional({ enum: StatusProcesso })
  @IsOptional() @IsEnum(StatusProcesso)
  statusInterno?: StatusProcesso;
}

export class AtualizarProcessoDto {
  @ApiPropertyOptional({ enum: StatusProcesso })
  @IsOptional() @IsEnum(StatusProcesso) statusInterno?: StatusProcesso;

  /**
   * Valor da causa — preenchimento MANUAL.
   *
   * A API pública do CNJ não publica este campo (verificado com
   * `exists: valorCausa` nos índices do TRT22 e do TJPI: zero documentos),
   * então ou alguém digita, ou ele nunca existe. `null` limpa o valor.
   */
  @ApiPropertyOptional({ description: 'Valor da causa em reais. Null limpa.' })
  @IsOptional() @Type(() => Number) @IsNumber() valorCausa?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsString() filiadoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() advogadoId?: string;

  /** Etiquetas internas — substituem a lista atual quando informadas. */
  @ApiPropertyOptional({ type: [String], description: 'Rótulos livres (Urgente, Coletiva…).' })
  @IsOptional() @IsArray() @IsString({ each: true })
  etiquetas?: string[];
}

/**
 * Formalização de um RASCUNHO (processo aberto a partir de uma consulta).
 * O NPU é obrigatório — é ele que tira o processo do rascunho. Os demais campos
 * são o caminho manual, para quando o tribunal ainda não indexou o processo no
 * CNJ (comum nos primeiros dias após a distribuição).
 */
export class FormalizarProcessoDto {
  @ApiProperty({ description: 'Número único (NPU/CNJ) — com ou sem pontuação.' })
  @IsString() @IsNotEmpty()
  numeroCNJ: string;

  @ApiPropertyOptional({ description: 'Sigla do tribunal. Omitida, é derivada do NPU.' })
  @IsOptional() @IsString() tribunal?: string;

  @ApiPropertyOptional({ description: 'Buscar os dados no DataJud logo após formalizar.' })
  @IsOptional() @IsBoolean() sincronizar?: boolean;

  // ---- Preenchimento manual (usado quando não se busca no DataJud) ----
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) classeProcessual?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) assuntoPrincipal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) orgaoJulgador?: string;
  @ApiPropertyOptional({ description: 'Data de distribuição (ISO).' })
  @IsOptional() @IsDateString() dataDistribuicao?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() valorCausa?: number;

  @ApiPropertyOptional({ enum: StatusProcesso, description: 'Status após formalizar (padrão PENDENTE).' })
  @IsOptional() @IsEnum(StatusProcesso) statusInterno?: StatusProcesso;
}

export class ListProcessosQueryDto {
  @ApiPropertyOptional({ description: 'Busca por NPU, classe ou nome do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ enum: StatusProcesso })
  @IsOptional() @IsEnum(StatusProcesso) statusInterno?: StatusProcesso;

  @ApiPropertyOptional() @IsOptional() @IsString() tribunal?: string;
  @ApiPropertyOptional({ description: 'Casa com QUALQUER filiado do processo, não só o principal.' })
  @IsOptional() @IsString() filiadoId?: string;
  @ApiPropertyOptional({ description: 'Casa com QUALQUER advogado do processo, não só o responsável.' })
  @IsOptional() @IsString() advogadoId?: string;

  @ApiPropertyOptional({ description: 'Todos os processos de uma parte cadastrada (ex.: uma empresa ré).' })
  @IsOptional() @IsString() parteExternaId?: string;

  // ---- Filtros rápidos da tabela ----
  @ApiPropertyOptional({ description: 'Só os processos do usuário logado ("meus").' })
  @IsOptional() @IsString() meus?: string;

  @ApiPropertyOptional({ description: 'Só os que não têm filiado vinculado.' })
  @IsOptional() @IsString() semFiliado?: string;

  @ApiPropertyOptional({ description: 'Só os que ainda não têm réu/parte contrária cadastrada.' })
  @IsOptional() @IsString() semParteContraria?: string;

  @ApiPropertyOptional({ description: 'Só os com movimentação nos últimos N dias (padrão 7).' })
  @IsOptional() @IsString() movimentacaoRecente?: string;
  /** Fase processual (ver `fase.util.ts`) — CONHECIMENTO | EXECUCAO | RECURSAL | ARQUIVADO. */
  @IsOptional() @IsIn(['CONHECIMENTO', 'EXECUCAO', 'RECURSAL', 'ARQUIVADO'])
  fase?: FaseProcessual;

  @ApiPropertyOptional({ description: 'Filtra por etiqueta interna.' })
  @IsOptional() @IsString() etiqueta?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
