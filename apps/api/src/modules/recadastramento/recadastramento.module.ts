import { Module } from '@nestjs/common';
import { LinkRecadastramentoService } from './link-recadastramento.service';
import {
  LinkRecadastramentoAdminController,
  LinkRecadastramentoRevogarController,
  RecadastroPublicoController,
} from './link-recadastramento.controller';
import { RecadastramentoController, RecadastramentosController } from './recadastramento.controller';
import { RecadastramentoService } from './recadastramento.service';
import { FiliadosModule } from '../filiados/filiados.module';
import { PortalFiliadoModule } from '../portal-filiado/portal-filiado.module';

/*
  O controller e o serviço do recadastro presencial moravam neste arquivo. Saíram
  em 13/09/2026 para `recadastramento.controller.ts` e `recadastramento.service.ts`:
  controller dentro de `*.module.ts` era justamente o que a varredura da matriz
  não enxergava (ver `a-matriz-e-a-unica-politica.spec.ts`).
*/
@Module({
  // FiliadosModule entra por causa da foto: o recadastramento online reaproveita
  // o mesmo processamento de imagem usado pela equipe.
  // PortalFiliadoModule entra para o link poder criar o PRIMEIRO acesso ao
  // portal na hora em que o filiado conclui o recadastramento.
  imports: [FiliadosModule, PortalFiliadoModule],
  controllers: [
    RecadastramentoController,
    RecadastramentosController,
    LinkRecadastramentoAdminController,
    LinkRecadastramentoRevogarController,
    RecadastroPublicoController,
  ],
  providers: [RecadastramentoService, LinkRecadastramentoService],
  exports: [RecadastramentoService, LinkRecadastramentoService],
})
export class RecadastramentoModule {}
