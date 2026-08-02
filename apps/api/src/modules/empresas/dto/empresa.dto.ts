import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, MinLength,
} from 'class-validator';

const TRIM = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateEmpresaDto {
  @ApiProperty({ example: '12345678000195', description: 'Com ou sem máscara — a API normaliza.' })
  @IsString()
  cnpj: string;

  @ApiProperty()
  @IsString() @Transform(TRIM) @MinLength(2) @MaxLength(200)
  razaoSocial: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Transform(TRIM) @MaxLength(200)
  nomeFantasia?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Transform(TRIM) @MaxLength(9)
  cep?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Transform(TRIM) @MaxLength(200)
  logradouro?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Transform(TRIM) @MaxLength(120)
  bairro?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Transform(TRIM) @MaxLength(120)
  cidade?: string;

  @ApiPropertyOptional({ example: 'PI' })
  @IsOptional() @IsString() @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Length(2, 2)
  uf?: string;

  /**
   * Definida pela secretaria e entregue à empresa. É gravada só como hash;
   * `primeiroAcesso` obriga a troca no primeiro login do portal patronal.
   *
   * OPCIONAL: nem toda empresa aqui é conveniada. A mesma tabela guarda a
   * empregadora de um colaborador PJ/terceirizado, que existe só como vínculo e
   * nunca acessa o portal — como o próprio schema já previa ("uma empresa só de
   * vínculo simplesmente não tem senha"). Omitir deixa `senhaHash` nulo, e a
   * empresa aparece no Patronal com "sem acesso ao portal".
   */
  @ApiPropertyOptional({ minLength: 6 })
  @IsOptional()
  @IsString() @MinLength(6, { message: 'A senha provisória deve ter ao menos 6 caracteres.' })
  @MaxLength(72, { message: 'A senha provisória deve ter no máximo 72 caracteres.' })
  senhaProvisoria?: string;
}

export class ListEmpresasQueryDto {
  @ApiPropertyOptional({ description: 'Busca por razão social, nome fantasia ou CNPJ.' })
  @IsOptional() @IsString() @Transform(TRIM)
  busca?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

/** Dados já limpos da BrasilAPI, no vocabulário do nosso cadastro. */
export interface DadosCnpj {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  /** Ex.: 'ATIVA', 'BAIXADA', 'INAPTA' — a tela avisa quando não está ATIVA. */
  situacao: string | null;
  /** Já existe no nosso banco? Evita preencher um formulário que daria 409. */
  jaCadastrada: boolean;
}
