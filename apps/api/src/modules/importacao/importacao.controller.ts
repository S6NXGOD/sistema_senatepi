import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { ImportacaoService } from './importacao.service';
import { RelatorioImportacaoService } from './relatorio.service';
import { FolhaPrefeituraService } from './folha-prefeitura.service';
import { lerCabecalhos } from './planilha.util';
import { pareceFolhaPrefeitura } from './folha-prefeitura.util';
import { detectarMapeamento } from './mapeamento.util';
import { ConfirmarImportacaoDto, EditarLinhaDto } from './dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('importacao')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@Controller('importacoes')
@Roles(UserRole.ADMINISTRADOR) // importação de filiados: apenas administradores
export class ImportacaoController {
  constructor(
    private readonly service: ImportacaoService,
    private readonly relatorio: RelatorioImportacaoService,
    private readonly folha: FolhaPrefeituraService,
  ) {}

  /**
   * UM ÚNICO BOTÃO DE IMPORTAR.
   *
   * O layout do arquivo é reconhecido pelos cabeçalhos e a rota encaminha para
   * o importador certo. Pedir ao operador que escolha entre "CSV legado" e
   * "folha da Prefeitura" num combo seria transferir para ele uma decisão que o
   * arquivo já responde — e a escolha errada importaria 4.000 pessoas pela
   * regra de identidade errada.
   */
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
    @Body('permitirReenvio') permitirReenvio?: string,
  ) {
    if (!file) throw new BadRequestException('Envie o arquivo no campo "arquivo"');

    const cabecalhos = await lerCabecalhos(file);
    if (pareceFolhaPrefeitura(cabecalhos))
      return this.folha.processarUpload(file, userId, {
        // Vem de multipart: chega como string, não booleano.
        permitirReenvio: permitirReenvio === 'true' || permitirReenvio === '1',
      });

    // XLSX que NÃO é a folha para aqui, com o motivo.
    //
    // O importador legado é de CSV: ele faz `buffer.toString('utf8')`. Um .xlsx
    // é um ZIP — passar por ali produziria linhas de lixo binário na prévia em
    // vez de um erro, e alguém poderia confirmar a importação sem perceber.
    // A tela passou a aceitar .xlsx por causa da folha; esta guarda é o que
    // impede que essa porta aberta chegue ao importador errado.
    if (/\.xlsx?$/i.test(file.originalname))
      throw new BadRequestException(
        'Esta planilha não tem as colunas da folha da Prefeitura (Órgão, Matrícula e Nome). ' +
          `Colunas lidas: ${cabecalhos.join(', ') || '(nenhuma)'}. ` +
          'A importação do cadastro legado aceita apenas arquivos .csv.',
      );

    // LAYOUT NÃO RECONHECIDO — falha aqui, e não linha a linha.
    //
    // Sem esta guarda, um arquivo cujo cabeçalho de nome não foi reconhecido
    // (`name` em vez de `nome`, por exemplo) passa pelo importador legado e
    // produz "Nome ausente" em TODAS as linhas. A tela então acusa 966 erros de
    // dado quando o dado está perfeito — o defeito é de mapeamento. Já vi isso
    // acontecer com o export do banco legado do SINDSERM, e a leitura errada
    // leva a pessoa a "consertar" uma planilha que não tem problema nenhum.
    const mapeadoLegado = detectarMapeamento(cabecalhos);
    if (!mapeadoLegado.some((m) => m.campo === 'nomeCompleto')) {
      const naoMapeadas = mapeadoLegado.filter((m) => !m.campo).map((m) => m.coluna);
      throw new BadRequestException(
        'Não reconheci o layout deste arquivo: nenhuma coluna corresponde ao NOME do filiado. ' +
          `Colunas não reconhecidas: ${naoMapeadas.join(', ') || '(nenhuma)'}. ` +
          'A folha da Prefeitura precisa de Órgão, Matrícula e Nome; ' +
          'o cadastro legado precisa ao menos de uma coluna "nome".',
      );
    }

    return this.service.processarUpload(file, userId);
  }

  @Get(':id')
  progresso(@Param('id') id: string) {
    return this.service.obterProgresso(id);
  }

  @Get(':id/linhas')
  linhas(
    @Param('id') id: string,
    @Query('busca') busca?: string,
    @Query('status') status?: 'validos' | 'erros' | 'duplicados',
    @Query('page') page?: number,
  ) {
    return this.service.listarLinhas(id, { busca, status, page });
  }

  @Get(':id/resumo-validacao')
  resumoValidacao(@Param('id') id: string) {
    return this.service.resumoValidacao(id);
  }

  @Patch(':id/linhas/:linhaId')
  editarLinha(
    @Param('id') id: string,
    @Param('linhaId') linhaId: string,
    @Body() dto: EditarLinhaDto,
  ) {
    return this.service.editarLinha(id, linhaId, dto);
  }

  @Post(':id/confirmar')
  confirmar(
    @Param('id') id: string,
    @Body() dto: ConfirmarImportacaoDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.confirmar(id, dto, { userId, ip: req.ip });
  }

  @Get(':id/relatorio.pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.relatorio.pdf(id);
    res.setHeader('Content-Disposition', `inline; filename="importacao-${id}.pdf"`);
    res.send(buffer);
  }

  @Get(':id/relatorio.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async excel(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.relatorio.excel(id);
    res.setHeader('Content-Disposition', `attachment; filename="importacao-${id}.xlsx"`);
    res.send(buffer);
  }
}
