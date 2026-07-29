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
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  criarDepartamento(@Body() dto: DepartamentoDto) {
    return this.service.criarDepartamento(dto);
  }
  @Patch('departamentos/:id')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  atualizarDepartamento(@Param('id') id: string, @Body() dto: DepartamentoDto) {
    return this.service.atualizarDepartamento(id, dto);
  }
  @Delete('departamentos/:id')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  removerDepartamento(@Param('id') id: string) {
    return this.service.removerDepartamento(id);
  }

  // ---- Cargos ----
  @Get('cargos')
  listarCargos() {
    return this.service.listarCargos();
  }
  @Post('cargos')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  criarCargo(@Body() dto: CargoDto) {
    return this.service.criarCargo(dto);
  }
  @Patch('cargos/:id')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  atualizarCargo(@Param('id') id: string, @Body() dto: CargoDto) {
    return this.service.atualizarCargo(id, dto);
  }
  @Delete('cargos/:id')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  removerCargo(@Param('id') id: string) {
    return this.service.removerCargo(id);
  }

  // ---- Empresas ----
  @Get('empresas')
  listarEmpresas() {
    return this.service.listarEmpresas();
  }
  @Post('empresas')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  criarEmpresa(@Body() dto: EmpresaDto) {
    return this.service.criarEmpresa(dto);
  }
  @Patch('empresas/:id')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  atualizarEmpresa(@Param('id') id: string, @Body() dto: EmpresaDto) {
    return this.service.atualizarEmpresa(id, dto);
  }
  @Delete('empresas/:id')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  removerEmpresa(@Param('id') id: string) {
    return this.service.removerEmpresa(id);
  }
}
