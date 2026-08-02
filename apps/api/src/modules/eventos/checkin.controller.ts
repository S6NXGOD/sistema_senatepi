import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { Request } from 'express';
import { CheckinService } from './checkin.service';
import { Public } from '../../common/decorators/public.decorator';

class EntrarDto {
  /** Aceita com ou sem máscara — o serviço normaliza. */
  @IsString() @Length(11, 14) cpf!: string;
}

/**
 * Segunda etapa — quando o CPF não localizou ninguém.
 *
 * Só o nome é obrigatório. A data de nascimento entra como desempate quando a
 * pessoa souber informar: ela existe em apenas 381 dos 7.173 cadastros ativos,
 * então exigi-la deixaria quase todo mundo de fora.
 */
class EntrarComDadosDto {
  @IsString() @Length(11, 14) cpf!: string;
  @IsString() @Length(5, 200) nomeCompleto!: string;
  @IsOptional() @IsDateString() dataNascimento?: string;
}

/**
 * ÁREA PÚBLICA da sala virtual — o filiado entra SEM login, só com o link.
 *
 * Mesmo desenho do recadastramento: nenhuma rota recebe id de filiado. A pessoa
 * informa o CPF, o servidor resolve quem é, e a partir daí a credencial da
 * sessão é o `presencaId` — um UUID que só quem fez o check-in recebeu.
 *
 * Não é autenticação forte, e não precisa ser: o que ele protege é o link de
 * uma reunião cujo acesso o próprio Meet controla. Exigir senha aqui afastaria
 * justamente o filiado de 60 anos que a assembleia precisa que participe.
 */
@ApiTags('plenario-publico')
@Public()
@Controller('sala')
export class CheckinPublicoController {
  constructor(private readonly service: CheckinService) {}

  /** Estado da sala antes do check-in. Não expõe o link nem quem já entrou. */
  @Get(':eventoId')
  abrir(@Param('eventoId') eventoId: string) {
    return this.service.salaPublica(eventoId);
  }

  @Post(':eventoId/checkin')
  entrar(
    @Param('eventoId') eventoId: string,
    @Body() dto: EntrarDto,
    @Req() req: Request,
  ) {
    // `req.ip` só é o endereço real por causa do `trust proxy` no main.ts —
    // sem ele, o Railway entregaria o IP do próprio proxy em todas as linhas.
    return this.service.entrar({
      eventoId,
      cpf: dto.cpf,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /**
   * Complementação dos dados — quando o CPF não localizou ninguém.
   *
   * Não é um "caminho alternativo para quem não é filiado": é o caminho normal
   * para os 70% da base cujo cadastro veio da planilha sem CPF. Quando o nome
   * bate com um único filiado sem CPF gravado, o vínculo é feito e o CPF
   * informado passa a constar do cadastro.
   */
  @Post(':eventoId/checkin/dados')
  entrarComDados(
    @Param('eventoId') eventoId: string,
    @Body() dto: EntrarComDadosDto,
    @Req() req: Request,
  ) {
    return this.service.entrarComDados({
      eventoId,
      cpf: dto.cpf,
      nomeCompleto: dto.nomeCompleto,
      dataNascimento: dto.dataNascimento,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /** Sala de quem já entrou — aqui sim o link da reunião é devolvido. */
  @Get(':eventoId/sessao/:presencaId')
  sessao(@Param('eventoId') eventoId: string, @Param('presencaId') presencaId: string) {
    return this.service.sessao(eventoId, presencaId);
  }
}
