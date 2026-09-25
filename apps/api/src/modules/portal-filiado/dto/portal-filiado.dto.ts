import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { UpdateFiliadoDto } from '../../filiados/dto/filiado.dto';
import {
  CAMPOS_DO_CADASTRO_PELO_LINK,
  VinculoPeloLinkDto,
} from '../../recadastramento/dto/recadastro-publico.dto';
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
 * O RECADASTRAMENTO PELO PORTAL — a MESMA lista do link, por construção.
 *
 * "Aqui não era pra ser possível o filiado fazer um recadastramento se quiser?"
 * — o dono, 25/09/2026, olhando a aba Cadastro. Era, e não era: o portal deixava
 * mexer só em endereço e telefone, enquanto o link mandado por WhatsApp deixava
 * atualizar o cadastro inteiro. Duas portas para a mesma pessoa, com regras
 * diferentes, e a mais completa era a que exigia alguém lembrar de enviar.
 *
 * `PickType(UpdateFiliadoDto, CAMPOS_DO_CADASTRO_PELO_LINK)` é o que impede as
 * duas de divergirem: **não existe uma segunda lista**. O dia em que um campo
 * entrar ou sair do link, entra ou sai daqui junto — e o serviço ainda filtra
 * por `camposDoLink()`, a mesma defesa em profundidade que o link tem.
 *
 * O QUE CONTINUA FORA: matrícula, situação e data de filiação. Não é
 * desconfiança — mudar a situação ou a data de filiação desfaria decisão do
 * sindicato, que tem portas próprias (desfiliação, reativação) com motivo e
 * termo assinado.
 *
 * O CPF ENTRA, como no link — mas ele é a CHAVE DE LOGIN do portal, então a
 * tela avisa em letras claras antes de deixar mexer.
 */
export class AtualizarMeuCadastroDto extends PickType(UpdateFiliadoDto, [
  ...CAMPOS_DO_CADASTRO_PELO_LINK,
  'dependentes',
] as const) {
  @ApiPropertyOptional({ type: [VinculoPeloLinkDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VinculoPeloLinkDto)
  vinculos?: VinculoPeloLinkDto[];
}

/** Filiado autenticado, anexado à requisição pela estratégia JWT do portal. */
export interface FiliadoAutenticado {
  id: string;
  nomeCompleto: string;
  matricula: string;
  /** A senha ainda é a provisória: o token fica preso na tela de troca. */
  primeiroAcesso: boolean;
}
