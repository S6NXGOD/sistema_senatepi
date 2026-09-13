import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { UpdateFiliadoDto } from '../../filiados/dto/filiado.dto';

/**
 * O QUE O FILIADO PODE GRAVAR PELO LINK — e nada além disso.
 *
 * O BURACO QUE ISTO FECHA (auditoria de 12/09/2026). O corpo de
 * `POST /recadastro/:token/enviar` era tipado como `UpdateFiliadoDto & {...}`.
 * Interseção não existe em tempo de execução: o TypeScript emite `Object` como
 * metatipo, e o `ValidationPipe` PULA metatipo `Object` — whitelist e
 * forbidNonWhitelisted não rodavam. O serviço espalhava o corpo direto no
 * `prisma.filiado.update`. Quem tivesse o token (e, com desafio NENHUM,
 * qualquer um que recebesse o link encaminhado) podia mandar `situacao` para se
 * reativar pulando a porta de reativação, `matricula`, `qrToken`, `fotoKey` e
 * até escrita aninhada: `cobrancas: { deleteMany: {} }`.
 *
 * A lista é a mesma que a página pública envia (recadastro/[token]/page.tsx).
 * Campo fora dela passa a dar 400 — e é o que se quer.
 */
export const CAMPOS_DO_CADASTRO_PELO_LINK = [
  'nomeCompleto',
  'cpf',
  'rg',
  'ufRg',
  'dataNascimento',
  'sexo',
  'estadoCivil',
  'naturalidade',
  'telefonePrincipal',
  'telefoneSecundario',
  'email',
  'cep',
  'endereco',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'estado',
  'formacao',
  'formacaoOutro',
  'numeroCoren',
  'dataAdmissao',
] as const;

export type CampoDoCadastroPeloLink = (typeof CAMPOS_DO_CADASTRO_PELO_LINK)[number];

/**
 * O LOCAL DE TRABALHO QUE O FILIADO DESCREVE.
 *
 * Classe própria, e não o `VinculoDto` da equipe: aquele aceita
 * `parteExternaId` (liga o vínculo a uma organização do cadastro) e
 * `descontoEmFolha` (diz ao financeiro em qual folha descontar). Nenhum dos dois
 * é o filiado quem decide — e os dois eram APAGADOS a cada recadastro pelo link,
 * porque a lista enviada substitui a gravada. Agora não entram pelo corpo, e o
 * serviço os herda do vínculo que já existia (`vinculosPeloLink`).
 */
export class VinculoPeloLinkDto {
  @ApiProperty() @IsString() @MaxLength(200) empresa: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) lotacao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) matricula?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) ordem?: number;
}

/**
 * CLASSE, e não interseção: é isso que faz o `design:paramtypes` apontar para
 * algo que o `ValidationPipe` sabe validar. O `seguranca.spec.ts` confere o
 * metatipo da rota e roda o pipe de verdade contra `situacao` e `cobrancas`.
 */
export class RecadastroPublicoDto extends PickType(UpdateFiliadoDto, [
  ...CAMPOS_DO_CADASTRO_PELO_LINK,
  // Mantém o `@ValidateNested` + `@Type` de `DependenteRecadastroDto`: o
  // item aninhado também passa pela whitelist.
  'dependentes',
] as const) {
  @ApiPropertyOptional({ type: [VinculoPeloLinkDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VinculoPeloLinkDto)
  vinculos?: VinculoPeloLinkDto[];

  /** A resposta do desafio, repetida: o servidor confere de novo antes de gravar. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) cpfConfirmacao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) dataNascimentoConfirmacao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) corenConfirmacao?: string;
}
