import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsDataNascimento, IsDataPassada } from '../../../common/validators/data.validators';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EstadoCivil,
  FormacaoProfissional,
  ModalidadeContribuicao,
  MotivoDesfiliacao,
  Sexo,
  SituacaoFiliado,
  TipoDependente,
} from '@prisma/client';

/**
 * LOCAL DE TRABALHO do filiado. Duplo vínculo é a regra na enfermagem, então
 * a lista aceita quantos forem necessários.
 */
export class VinculoDto {
  @ApiProperty({ description: 'Nome do empregador (snapshot, sempre gravado).' })
  @IsString() empresa: string;

  @ApiPropertyOptional({
    description:
      'Id do empregador no cadastro de organizações (partes externas), quando escolhido ' +
      'no combobox. Nulo = digitado à mão, e tudo bem: exigir cadastro prévio travaria o balcão.',
  })
  @IsOptional() @IsString() parteExternaId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() cargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() matricula?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'A mensalidade sindical é descontada na folha DESTE local.',
  })
  @IsOptional() @IsBoolean() descontoEmFolha?: boolean;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() ordem?: number;
}

/**
 * Dependente dentro de um recadastramento/edição do filiado.
 *
 * Com `id` = dependente que já existe (atualiza); sem `id` = novo. Os que
 * ficarem de fora da lista são removidos — é assim que o titular tira um
 * dependente que não se aplica mais.
 */
export class DependenteRecadastroDto {
  @ApiPropertyOptional({ description: 'Ausente quando é um dependente novo.' })
  @IsOptional() @IsString() id?: string;

  @ApiProperty({ enum: TipoDependente })
  @IsEnum(TipoDependente) tipo: TipoDependente;

  @ApiProperty() @IsString() nome: string;

  @ApiPropertyOptional() @IsOptional() @IsString() cpf?: string;

  @ApiProperty({ description: 'AAAA-MM-DD' })
  @IsDataNascimento() dataNascimento: string;
}

export class CreateFiliadoDto {
  // Dados pessoais
  @ApiProperty() @IsString() nomeCompleto: string;
  @ApiProperty() @IsString() cpf: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rg?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ufRg?: string;
  @ApiProperty() @IsDataNascimento() dataNascimento: string;
  @ApiPropertyOptional({ enum: Sexo }) @IsOptional() @IsEnum(Sexo) sexo?: Sexo;
  @ApiPropertyOptional({ enum: EstadoCivil })
  @IsOptional() @IsEnum(EstadoCivil) estadoCivil?: EstadoCivil;
  @ApiPropertyOptional() @IsOptional() @IsString() naturalidade?: string;

  // Contato
  @ApiPropertyOptional() @IsOptional() @IsString() telefonePrincipal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() telefoneSecundario?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;

  // Endereço
  @ApiPropertyOptional() @IsOptional() @IsString() cep?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endereco?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() numero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complemento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bairro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cidade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() estado?: string;

  // Profissional
  @ApiPropertyOptional({ enum: FormacaoProfissional })
  @IsOptional() @IsEnum(FormacaoProfissional) formacao?: FormacaoProfissional;
  @ApiPropertyOptional({ description: 'Descrição quando formação = OUTRO' })
  @IsOptional() @IsString() formacaoOutro?: string;
  @ApiPropertyOptional({ example: 'COREN-PI 123456-ENF', description: 'Formato: COREN-PI 000000-SSS' })
  @IsOptional()
  @Matches(/^COREN-PI \d{1,6}-[A-Z]{3}$/, {
    message: 'COREN inválido. Use o formato COREN-PI 000000-SSS (ex.: COREN-PI 123456-ENF).',
  })
  numeroCoren?: string;
  @ApiPropertyOptional() @IsOptional() @IsDataPassada() dataAdmissao?: string;

  @ApiPropertyOptional({
    enum: ModalidadeContribuicao,
    description:
      'Como o filiado contribui. DESCONTO_FOLHA aponta para os locais de trabalho ' +
      'marcados com desconto — é lá que se sabe em QUAL folha o desconto ocorre.',
  })
  @IsOptional() @IsEnum(ModalidadeContribuicao)
  modalidadeContribuicao?: ModalidadeContribuicao;

  @ApiPropertyOptional({ type: [VinculoDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VinculoDto)
  vinculos?: VinculoDto[];

  /**
   * Lista COMPLETA de dependentes. Omitir o campo mantém os atuais; enviar a
   * lista substitui o conjunto (cria, atualiza e remove o que ficou de fora).
   */
  @ApiPropertyOptional({ type: [DependenteRecadastroDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DependenteRecadastroDto)
  dependentes?: DependenteRecadastroDto[];
}

export class UpdateFiliadoDto extends PartialType(CreateFiliadoDto) {
  @ApiPropertyOptional({ enum: SituacaoFiliado })
  @IsOptional() @IsEnum(SituacaoFiliado) situacao?: SituacaoFiliado;
}

export class ChangeSituacaoDto {
  @ApiProperty({ enum: SituacaoFiliado })
  @IsEnum(SituacaoFiliado) situacao: SituacaoFiliado;
  @ApiPropertyOptional() @IsOptional() @IsString() motivo?: string;
}

/**
 * Desfiliação. O MOTIVO passou a ser obrigatório e padronizado: o texto livre
 * anterior não respondia "quantos saíram por inadimplência?", que é a pergunta
 * que a diretoria faz. A observação continua livre, ao lado.
 */
export class DesfiliarDto {
  @ApiProperty({
    enum: MotivoDesfiliacao,
    description: 'Motivo padronizado — é o que vira estatística.',
  })
  @IsEnum(MotivoDesfiliacao, { message: 'Selecione o motivo da desfiliação.' })
  motivo: MotivoDesfiliacao;

  @ApiPropertyOptional({ description: 'Complemento livre, quando a categoria não basta.' })
  @IsOptional() @IsString() @MaxLength(1000)
  observacoes?: string;

  @ApiPropertyOptional({
    description:
      'Data do pedido (ISO). Omitida, usa hoje — é o carimbo de quando a saída foi formalizada.',
  })
  @IsOptional() @IsDataPassada()
  dataPedido?: string;

  @ApiPropertyOptional({
    example: '2026-08',
    description:
      'Última mensalidade a cobrar (AAAA-MM). É o que a folha usa para saber até quando descontar.',
  })
  @IsOptional() @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mês de corte inválido — use o formato AAAA-MM.' })
  mesCorte?: string;
}

export class ListFiliadosQueryDto {
  @ApiPropertyOptional({ description: 'Busca livre (nome, CPF ou matrícula)' })
  @IsOptional() @IsString() busca?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nome?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cpf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() coren?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cidade?: string;
  @ApiPropertyOptional({ enum: SituacaoFiliado })
  @IsOptional() @IsEnum(SituacaoFiliado) situacao?: SituacaoFiliado;
  @ApiPropertyOptional({ description: 'Data de filiação inicial (YYYY-MM-DD)' })
  @IsOptional() @IsString() dataInicio?: string;
  @ApiPropertyOptional({ description: 'Data de filiação final (YYYY-MM-DD)' })
  @IsOptional() @IsString() dataFim?: string;
  /**
   * Ordenação da lista. O padrão é `recentes` — o último cadastrado primeiro.
   *
   * `cadastro` e `filiacao` são critérios DIFERENTES e a distinção importa:
   * a carga legada trouxe 1.895 filiados sem data de filiação conhecida, que
   * têm data de cadastro mas não de filiação. Ordenar por filiação joga esses
   * para o fim da lista (nulls last), nunca para o topo.
   */
  @ApiPropertyOptional({
    enum: ['recentes', 'antigos', 'nome', 'nome_desc', 'filiacao_recente', 'filiacao_antiga'],
    default: 'recentes',
  })
  @IsOptional()
  @IsIn(['recentes', 'antigos', 'nome', 'nome_desc', 'filiacao_recente', 'filiacao_antiga'])
  ordenar?: 'recentes' | 'antigos' | 'nome' | 'nome_desc' | 'filiacao_recente' | 'filiacao_antiga';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() pageSize?: number;
}
