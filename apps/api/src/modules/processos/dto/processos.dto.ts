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
import { AREAS_JURIDICAS } from '../areas.catalogo';
import { ORDENS_PROCESSO } from '../utils/ordenacao.util';

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

  /**
   * O ROBÔ DE PRAZOS DEVE OLHAR ESTE PROCESSO NA ENTRADA?
   *
   * Padrão SIM, que é o caso do cadastro avulso: o advogado acabou de ajuizar
   * ou de receber o caso, e uma intimação recente nas movimentações é trabalho
   * de verdade que ninguém viu ainda.
   *
   * A MIGRAÇÃO DE ACERVO é o caso oposto, e foi o que apareceu na produção de
   * 31/08/2026. Dos 82 processos importados da planilha, sete movimentações
   * dentro da janela de 30 dias viraram quatro tarefas "Verificação de
   * Intimação / Prazo" — todas de atos com 25 a 28 dias, todas já vencidas na
   * hora em que nasceram. E não podia ser diferente: são processos que o
   * escritório acompanha há ANOS, cujas publicações daquele mês já foram lidas,
   * respondidas e protocoladas fora do sistema. A tarefa não avisava de nada
   * novo — mandava conferir o que já estava conferido.
   *
   * O robô não tem como distinguir "processo novo" de "processo antigo que
   * acabou de entrar no sistema": para ele as duas coisas são um processo
   * criado hoje com movimentações recentes. Quem sabe a diferença é quem está
   * importando, e é por isso que a decisão é um parâmetro e não uma heurística.
   */
  @ApiPropertyOptional({
    default: true,
    description:
      'Deixa o robô de prazos avaliar as movimentações recém-importadas. Use `false` ao migrar ' +
      'um acervo já acompanhado fora do sistema — senão nascem tarefas para prazos já cumpridos.',
  })
  @IsOptional() @IsBoolean()
  criarTarefasDePrazo?: boolean;

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
    description:
      'Réu único. MANTIDO por compatibilidade — o caminho novo é `partesContrarias`, ' +
      'que aceita litisconsórcio. Quando os dois vierem, este entra como o primeiro.',
  })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ParteContrariaImportDto)
  parteContraria?: ParteContrariaImportDto;

  @ApiPropertyOptional({
    type: [ParteContrariaImportDto],
    description:
      'RÉUS do processo (litisconsórcio passivo). O primeiro é o principal — é ele que ' +
      'aparece no "Autor × Réu" da lista. O DataJud não devolve partes, então este é o ' +
      'momento barato de capturar todos.',
  })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ParteContrariaImportDto)
  partesContrarias?: ParteContrariaImportDto[];

  @ApiPropertyOptional({ enum: StatusProcesso })
  @IsOptional() @IsEnum(StatusProcesso)
  /**
   * Área jurídica — slug de `AREAS_JURIDICAS`.
   *
   * ELA FALTAVA AQUI, e o buraco era silencioso: a importação em lote passava
   * `categoria` no objeto, o TypeScript não reclamava (spread condicional
   * derrota a checagem de propriedade excedente) e o valor sumia. Na primeira
   * carga real, 82 processos entraram sem área — e o filtro de área, que existe
   * na tela, ficou sem nada para encontrar.
   */
  @ApiPropertyOptional({ enum: AREAS_JURIDICAS.map((a) => a.slug) })
  @IsOptional() @IsString()
  categoria?: string;

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
  @ApiPropertyOptional({ type: [String], description: 'Rótulos livres (Coletiva, Fase de Execução…).' })
  @IsOptional() @IsArray() @IsString({ each: true })
  etiquetas?: string[];

  @ApiPropertyOptional({
    enum: AREAS_JURIDICAS.map((a) => a.slug),
    description: 'Área jurídica. String vazia limpa.',
  })
  @IsOptional() @IsString()
  categoria?: string;

  @ApiPropertyOptional({ description: 'Marca/desmarca o processo como urgente.' })
  @IsOptional() @IsBoolean() urgente?: boolean;

  @ApiPropertyOptional({
    description: 'POR QUE é urgente — obrigatório ao marcar. Sem motivo a marca não se revisa.',
  })
  @IsOptional() @IsString() @MaxLength(300) urgenteMotivo?: string;
}

/**
 * AJUIZAMENTO de um caso pré-processual (aberto a partir de uma consulta).
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

  @ApiPropertyOptional({
    description:
      'Assunto do CNJ, casamento EXATO, inclusive quando for secundário. É o link do Panorama.',
  })
  @IsOptional() @IsString() @MaxLength(160) assunto?: string;

  @ApiPropertyOptional({
    enum: ['ATIVO', 'PASSIVO'],
    description:
      'Restringe a busca por NOME de parte e o filtro por parte cadastrada a um polo.',
  })
  @IsOptional() @IsIn(['ATIVO', 'PASSIVO']) polo?: 'ATIVO' | 'PASSIVO';

  /**
   * DE QUE LADO O SINDICATO ESTÁ — e não confundir com `polo`, que é o lado da
   * parte PROCURADA na busca por nome. São perguntas diferentes: uma refina o
   * que foi digitado, a outra recorta o acervo pelo papel da própria entidade.
   */
  @ApiPropertyOptional({
    enum: ['AUTOR', 'REU', 'REPRESENTANDO'],
    description:
      'AUTOR: o sindicato move a ação. REU: o sindicato é processado. ' +
      'REPRESENTANDO: o sindicato não é parte — o filiado é, e nós somos o patrono.',
  })
  @IsOptional()
  @IsIn(['AUTOR', 'REU', 'REPRESENTANDO'])
  nossoPapel?: 'AUTOR' | 'REU' | 'REPRESENTANDO';

  // ---- Filtros rápidos da tabela ----
  @ApiPropertyOptional({ description: 'Só os processos do usuário logado ("meus").' })
  @IsOptional() @IsString() meus?: string;

  @ApiPropertyOptional({ description: 'Só os que não têm filiado vinculado.' })
  @IsOptional() @IsString() semFiliado?: string;

  @ApiPropertyOptional({ description: 'Só os que ainda não têm réu/parte contrária cadastrada.' })
  @IsOptional() @IsString() semParteContraria?: string;

  @ApiPropertyOptional({ description: 'Só os com movimentação nos últimos N dias (padrão 7).' })
  @IsOptional() @IsString() movimentacaoRecente?: string;
  /** Fase processual (ver `fase.util.ts`). */
  @IsOptional()
  @IsIn(['PRE_PROCESSUAL', 'CONHECIMENTO', 'EXECUCAO', 'RECURSAL', 'ARQUIVADO'])
  fase?: FaseProcessual;

  @ApiPropertyOptional({ description: 'Filtra por etiqueta interna.' })
  @IsOptional() @IsString() etiqueta?: string;

  @ApiPropertyOptional({ enum: AREAS_JURIDICAS.map((a) => a.slug), description: 'Área jurídica.' })
  @IsOptional() @IsIn(AREAS_JURIDICAS.map((a) => a.slug))
  categoria?: string;

  @ApiPropertyOptional({ description: 'Só os marcados como urgentes.' })
  @IsOptional() @IsString() urgente?: string;

  /**
   * INCLUIR OS CASOS PRÉ-PROCESSUAIS na listagem. Padrão: NÃO.
   *
   * POR QUE O PADRÃO É ESCONDER. O caso pré-processual não tem NPU, nem classe,
   * nem tribunal, nem movimentação — misturado à lista de processos ele produz
   * linhas quase vazias que empurram para baixo o que a equipe foi procurar, e
   * ainda estragam a contagem ("temos 412 processos" incluindo 60 consultas que
   * talvez nunca virem ação). São duas filas de trabalho diferentes.
   *
   * NÃO É O MESMO QUE SUMIR: a fila tem aba própria (`fase=PRE_PROCESSUAL`), que
   * passa este parâmetro. Filtrar explicitamente por ela também os traz.
   */
  @ApiPropertyOptional({ description: 'Inclui os casos pré-processuais (padrão: não).' })
  @IsOptional() @IsString() incluirPreProcessuais?: string;

  @ApiPropertyOptional({ default: 1 })
  /**
   * Como ordenar. Ver `ORDENACAO` em `processos.service.ts`.
   *
   * SEM @IsIn de propósito: o serviço cai no padrão quando não reconhece o
   * valor. Um link salvo nos favoritos com uma ordem que deixou de existir tem
   * de abrir a lista, não devolver 400 numa tela que a pessoa usa todo dia.
   */
  @ApiPropertyOptional({ enum: ORDENS_PROCESSO })
  @IsOptional() @IsString() ordem?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
