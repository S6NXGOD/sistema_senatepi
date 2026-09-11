import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength,
  Min, MinLength,
} from 'class-validator';
import { ESCOPOS, FILTROS_DE_SITUACAO, ORDENS } from '../lista-de-entes.util';

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

  /** Só vale no recorte "Brasil" — nos outros a UF já está decidida. */
  @IsOptional()
  @IsString()
  uf?: string;

  /** Onde procurar: `atuacao` (padrão), `uf` (o estado da casa) ou `brasil`. */
  @IsOptional()
  @IsIn([...ESCOPOS])
  escopo?: string;

  /** `impedidos`, `alerta`, `regular` ou `sem_numero` — ver `FILTROS_DE_SITUACAO`. */
  @IsOptional()
  @IsIn([...FILTROS_DE_SITUACAO])
  situacao?: string;

  /** `presenca` (padrão), `percentual` ou `nome`. */
  @IsOptional()
  @IsIn([...ORDENS])
  ordem?: string;

  /**
   * LEGADO — a tela anterior mandava estes três. Continuam aceitos para o
   * navegador que ainda roda a versão antiga durante a janela de troca não
   * levar 400 (o `ValidationPipe` recusa campo não declarado).
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
   * Códigos a atualizar agora. Vazio = a varredura escolhe sozinha os que estão
   * defasados, entre os de onde o sindicato atua.
   *
   * O teto de 60 não é arbitrário: cada ente custa ~2,7 s no Tesouro (medido:
   * 196 s para uma rodada de 71), e o pedido da tela tem cinco minutos. Um
   * ente só — o botão "buscar agora" da ficha — leva poucos segundos.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @Type(() => Number)
  @IsInt({ each: true })
  codigos?: number[];
}

/**
 * "MONTE ALEGRE" É MONTE ALEGRE DO PIAUÍ — a grafia exata, como está no
 * cadastro, e o município escolhido.
 *
 * `estado` nulo casa com filiado SEM estado. É assim que a pendência chega
 * (agrupada pelo par cidade/estado cru), e é assim que ela tem de voltar: um
 * `estado` "corrigido" no caminho faria o clique não achar ninguém.
 */
export class LigarCidadeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  cidade!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  estado?: string | null;

  /** Código IBGE de município: 7 dígitos, de 1.100.000 a 5.399.999. */
  @Type(() => Number)
  @IsInt()
  @Min(1_100_000)
  @Max(5_399_999)
  codigo!: number;
}

/** "O HGV é do Estado do Piauí." */
export class LigarOrganizacaoDto {
  @IsUUID()
  parteExternaId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  enteCodigo!: number;
}
