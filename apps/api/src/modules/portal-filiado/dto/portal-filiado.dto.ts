import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TAMANHO_MINIMO_SENHA } from '../senha-provisoria.util';

export class LoginFiliadoDto {
  @ApiProperty({
    example: '123.456.789-00',
    description:
      'CPF, com ou sem máscara. É a única porta do portal (decisão do dono, ' +
      '25/09/2026): quem não tem CPF no cadastro se recadastra na secretaria.',
  })
  @IsString()
  cpf: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  senha: string;
}

export class TrocarSenhaDto {
  @ApiProperty({
    minLength: TAMANHO_MINIMO_SENHA,
    description: 'Substitui a senha provisória gerada pelo sistema.',
  })
  @IsString()
  @MinLength(TAMANHO_MINIMO_SENHA, {
    message: `A nova senha deve ter ao menos ${TAMANHO_MINIMO_SENHA} caracteres.`,
  })
  @MaxLength(72, { message: 'A nova senha deve ter no máximo 72 caracteres.' })
  novaSenha: string;
}

/**
 * O QUE O FILIADO PODE MUDAR SOZINHO.
 *
 * "O que o filiado recadastrar e digitar é o dado válido, não precisa alguém
 * confirmar nada." — o dono, 24/09/2026. É como o link de recadastramento já
 * funciona (grava direto, sem fila).
 *
 * O QUE **NÃO** ESTÁ AQUI é a lista que importa: nome, CPF, matrícula, situação
 * e data de filiação ficam de fora. Não por desconfiança — é que mudar o
 * próprio CPF trocaria a chave de login e a identidade da pessoa no acervo, e
 * mudar a situação ou a data de filiação desfaria decisão do sindicato. Essas
 * passam pela secretaria, que tem as portas próprias (desfiliação, reativação).
 */
export class AtualizarMeuCadastroDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) endereco?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(12) numero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) complemento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) bairro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) cidade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2) estado?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(9) cep?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) telefonePrincipal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) telefoneSecundario?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
}

/** Filiado autenticado, anexado à requisição pela estratégia JWT do portal. */
export interface FiliadoAutenticado {
  id: string;
  nomeCompleto: string;
  matricula: string;
  /** A senha ainda é a provisória: o token fica preso na tela de troca. */
  primeiroAcesso: boolean;
}
