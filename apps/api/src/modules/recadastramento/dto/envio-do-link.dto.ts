import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { MEIOS_DE_ENVIO, MeioDeEnvio } from '../planejar-envio';

/** Por onde a equipe vai mandar o link. Só registra — o sistema não envia nada. */
export class EnvioDoLinkDto {
  @ApiProperty({ enum: MEIOS_DE_ENVIO })
  @IsIn(MEIOS_DE_ENVIO as unknown as string[], {
    message: 'Escolha como o link vai ser enviado: WhatsApp, compartilhar, copiar ou e-mail.',
  })
  meio: MeioDeEnvio;
}
