import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CadastrosService } from './cadastros.service';
import { CargoDto, DepartamentoDto, EmpresaDto } from './dto/cadastros.dto';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Cadastros Base / Parâmetros. Leitura para qualquer autenticado (alimenta os
 * selects dos formulários); escrita restrita à diretoria.
 * Prefixo global `api` → /api/cadastros/*.
 */
@ApiTags('cadastros-base')
@ApiBearerAuth()
@Controller('cadastros')
export class CadastrosController {
  constructor(private readonly service: CadastrosService) {}

  // ---- Departamentos ----
  @Get('departamentos')
  listarDepartamentos() {
    return this.service.listarDepartamentos();
  }
  @Post('departamentos')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  criarDepartamento(@Body() dto: DepartamentoDto) {
    return this.service.criarDepartamento(dto);
  }
  @Patch('departamentos/:id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  atualizarDepartamento(@Param('id') id: string, @Body() dto: DepartamentoDto) {
    return this.service.atualizarDepartamento(id, dto);
  }
  @Delete('departamentos/:id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  removerDepartamento(@Param('id') id: string) {
    return this.service.removerDepartamento(id);
  }

  // ---- Cargos ----
  @Get('cargos')
  listarCargos() {
    return this.service.listarCargos();
  }
  @Post('cargos')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  criarCargo(@Body() dto: CargoDto) {
    return this.service.criarCargo(dto);
  }
  @Patch('cargos/:id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  atualizarCargo(@Param('id') id: string, @Body() dto: CargoDto) {
    return this.service.atualizarCargo(id, dto);
  }
  @Delete('cargos/:id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  removerCargo(@Param('id') id: string) {
    return this.service.removerCargo(id);
  }

  // ---- Empresas ----
  @Get('empresas')
  listarEmpresas() {
    return this.service.listarEmpresas();
  }
  @Post('empresas')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  criarEmpresa(@Body() dto: EmpresaDto) {
    return this.service.criarEmpresa(dto);
  }
  @Patch('empresas/:id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  atualizarEmpresa(@Param('id') id: string, @Body() dto: EmpresaDto) {
    return this.service.atualizarEmpresa(id, dto);
  }
  @Delete('empresas/:id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  removerEmpresa(@Param('id') id: string) {
    return this.service.removerEmpresa(id);
  }
}
