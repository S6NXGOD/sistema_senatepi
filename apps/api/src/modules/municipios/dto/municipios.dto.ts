import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min,
} from 'class-validator';

/**
 * O `ValidationPipe` global usa `forbidNonWhitelisted: true`: query string ou
 * campo de corpo que não esteja declarado aqui vira 400, e não é ignorado. Por
 * isso todo filtro da tela precisa de uma linha neste arquivo.
 */

/** Checkbox chega como a string "true" — sem isto, `IsBoolean` recusa. */
const comoBooleano = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class ListarMunicipiosQueryDto {
  @IsOptional()
  @IsString()
  busca?: string;

  @IsOptional()
  @IsString()
  uf?: string;

  /**
   * 'M' (padrão), 'E' ou 'U'. O `ValidationPipe` global recusa campo não
   * declarado, então sem esta linha o filtro viraria 400 em vez de ser
   * ignorado.
   */
  @IsOptional()
  @IsIn(['M', 'E', 'U'])
  esfera?: string;

  @IsOptional()
  @Transform(comoBooleano)
  @IsBoolean()
  soComVinculo?: boolean;

  @IsOptional()
  @Transform(comoBooleano)
  @IsBoolean()
  soAcimaDoLimite?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class SincronizarSiconfiDto {
  /**
   * Códigos do IBGE a atualizar agora. Vazio = a varredura escolhe sozinha os
   * que estão defasados, que é o comportamento do job da madrugada.
   *
   * O teto de 60 não é arbitrário: o universo do sindicato inteiro são 72
   * municípios, e um pedido maior que isso significa que a tela está mandando
   * algo que ninguém pediu.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @Type(() => Number)
  @IsInt({ each: true })
  codigos?: number[];
}
