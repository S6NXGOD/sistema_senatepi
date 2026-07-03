import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria,
  EstrategiaDuplicado,
  EstrategiaMatricula,
  Prisma,
  SituacaoFiliado,
  StatusCarteirinha,
  StatusImportacao,
  TipoHistoricoFiliado,
} from '@prisma/client';
import * as Papa from 'papaparse';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { QrCodeService } from '../../common/qrcode/qrcode.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  CODIGO_LABEL,
  cpfValido,
  cpfVazioOuPlaceholder,
  detectarMapeamento,
  emailValido,
  limpar,
  limparCpf,
  mapearEstadoCivil,
  mapearFormacao,
  mapearSexo,
  mapearSituacao,
  parseData,
} from './mapeamento.util';

const CHUNK = 500;

interface DadosNormalizados {
  matricula?: string;
  nomeCompleto?: string;
  cpf: string;
  rg?: string;
  dataNascimento?: string | null;
  sexo?: string | null;
  estadoCivil?: string | null;
  naturalidade?: string;
  telefonePrincipal?: string;
  telefoneSecundario?: string;
  email?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  formacao: string;
  formacaoOutro: string | null;
  empresa?: string;
  dataAdmissao?: string | null;
  situacao: SituacaoFiliado;
  dataFiliacao?: string | null;
}

@Injectable()
export class ImportacaoService {
  private readonly logger = new Logger(ImportacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Etapa 1-3: upload + pré-processamento + validação
  // --------------------------------------------------------------------------
  async processarUpload(file: Express.Multer.File, userId?: string) {
    if (!file) throw new BadRequestException('Arquivo CSV é obrigatório');

    // Decodifica UTF-8; se vier com caracteres inválidos (base legada latin1), refaz em latin1
    let conteudo = file.buffer.toString('utf8');
    if (conteudo.includes('�')) conteudo = file.buffer.toString('latin1');
    conteudo = conteudo.replace(/^﻿/, '');

    const parsed = Papa.parse<Record<string, string>>(conteudo, {
      header: true,
      skipEmptyLines: true,
      delimiter: '', // autodetecta , ; \t
    });
    const headers = parsed.meta.fields ?? [];
    if (headers.length === 0) throw new BadRequestException('CSV sem cabeçalho reconhecível');

    const mapeamento = detectarMapeamento(headers);
    const colunaPorCampo: Record<string, string> = {};
    for (const m of mapeamento) if (m.campo) colunaPorCampo[m.campo] = m.coluna;
    const rows = parsed.data;

    // Pré-carrega filiados existentes (mapeados por CPF e por matrícula) para citar o registro
    const existentes = await this.prisma.filiado.findMany({
      select: { cpf: true, matricula: true, nomeCompleto: true },
    });
    const existeCpf = new Map<string, { matricula: string; nome: string }>();
    const existeMat = new Map<string, { nome: string }>();
    for (const f of existentes) {
      if (f.cpf) existeCpf.set(f.cpf, { matricula: f.matricula, nome: f.nomeCompleto });
      existeMat.set(f.matricula, { nome: f.nomeCompleto });
    }

    // Primeira linha onde cada CPF/matrícula apareceu (para referenciar a duplicata)
    const cpfPrimeiraLinha = new Map<string, number>();
    const matPrimeiraLinha = new Map<string, number>();

    const importacao = await this.prisma.importacao.create({
      data: {
        nomeArquivo: file.originalname,
        tamanhoBytes: file.size,
        status: StatusImportacao.VALIDANDO,
        total: rows.length,
        mapeamento: mapeamento as unknown as Prisma.InputJsonValue,
        userId,
      },
    });

    let validos = 0;
    let comErro = 0;
    let duplicados = 0;
    const linhas: Prisma.ImportacaoLinhaCreateManyInput[] = [];

    rows.forEach((row, idx) => {
      const numLinha = idx + 1;
      const get = (campo: string) => limpar(row[colunaPorCampo[campo]]);
      const cpfBruto = limparCpf(row[colunaPorCampo['cpf']]);
      const semCpf = cpfVazioOuPlaceholder(cpfBruto);
      const cpf = semCpf ? '' : cpfBruto; // placeholders (vazio/repetidos) viram "sem CPF"
      const nome = get('nomeCompleto');
      const matricula = get('matricula');

      const erros: string[] = [];
      const avisos: string[] = [];
      const codigos: string[] = [];

      // Obrigatórios
      if (!nome) {
        erros.push('Nome em branco — preencha o nome do filiado.');
        codigos.push('NOME_AUSENTE');
      }
      // CPF: placeholder/vazio vira "sem CPF" (aviso); senão valida o dígito verificador.
      if (!semCpf && !cpfValido(cpf)) {
        erros.push(
          cpf.length !== 11
            ? `CPF com ${cpf.length} dígito(s) — esperado 11.`
            : 'CPF inválido — dígito verificador não confere (provável erro de digitação na origem).',
        );
        codigos.push('CPF_INVALIDO');
      }

      // CPF duplicado no arquivo (bloqueia — não pode gravar o mesmo CPF 2x)
      if (cpf) {
        const primeira = cpfPrimeiraLinha.get(cpf);
        if (primeira) {
          erros.push(`CPF repetido no arquivo — igual ao da linha ${primeira}.`);
          codigos.push('CPF_DUP_ARQUIVO');
        } else {
          cpfPrimeiraLinha.set(cpf, numLinha);
        }
      }
      // Matrícula duplicada no arquivo (aviso — será gerada nova ou dispensada, conforme a opção)
      if (matricula) {
        const primeira = matPrimeiraLinha.get(matricula);
        if (primeira) {
          avisos.push(`Matrícula ${matricula} repetida no arquivo (linha ${primeira}).`);
          codigos.push('MATRICULA_DUP_ARQUIVO');
        } else {
          matPrimeiraLinha.set(matricula, numLinha);
        }
      }

      // Datas (avisos com o valor recebido)
      const dnRaw = row[colunaPorCampo['dataNascimento']];
      const daRaw = row[colunaPorCampo['dataAdmissao']];
      const dfRaw = row[colunaPorCampo['dataFiliacao']];
      const dn = parseData(dnRaw);
      const da = parseData(daRaw);
      const df = parseData(dfRaw);
      if (dn === 'INVALIDA') { avisos.push(`Data de nascimento inválida ("${limpar(dnRaw)}") — ignorada.`); codigos.push('DATA_INVALIDA'); }
      if (da === 'INVALIDA') { avisos.push(`Data de admissão inválida ("${limpar(daRaw)}") — ignorada.`); codigos.push('DATA_INVALIDA'); }
      if (df === 'INVALIDA') { avisos.push(`Data de filiação inválida ("${limpar(dfRaw)}") — ignorada.`); codigos.push('DATA_INVALIDA'); }

      // E-mail
      const email = get('email');
      if (!emailValido(email)) { avisos.push(`E-mail inválido ("${email}") — ignorado.`); codigos.push('EMAIL_INVALIDO'); }

      if (semCpf) { avisos.push('Sem CPF — será importado sem CPF.'); codigos.push('SEM_CPF'); }

      // Duplicado no sistema: por CPF quando existe; senão por matrícula (sem CPF)
      let duplicadoNoSistema = false;
      if (cpf && existeCpf.has(cpf)) {
        const ex = existeCpf.get(cpf)!;
        avisos.push(`CPF já cadastrado no sistema — matrícula ${ex.matricula}, ${ex.nome}.`);
        codigos.push('DUP_SISTEMA_CPF');
        duplicadoNoSistema = true;
      } else if (semCpf && matricula && existeMat.has(matricula)) {
        const ex = existeMat.get(matricula)!;
        avisos.push(`Matrícula ${matricula} já existe no sistema (${ex.nome}).`);
        codigos.push('DUP_SISTEMA_MATRICULA');
        duplicadoNoSistema = true;
      }

      const valido = erros.length === 0;

      const naturalidade = get('naturalidade');
      const ufNat = get('ufNaturalidade');
      const { formacao, formacaoOutro } = mapearFormacao(row[colunaPorCampo['formacao']]);

      const dados: DadosNormalizados = {
        matricula,
        nomeCompleto: nome,
        cpf,
        rg: get('rg'),
        dataNascimento: dn && dn !== 'INVALIDA' ? dn.toISOString() : null,
        sexo: mapearSexo(row[colunaPorCampo['sexo']]),
        estadoCivil: mapearEstadoCivil(row[colunaPorCampo['estadoCivil']]),
        naturalidade: naturalidade ? `${naturalidade}${ufNat ? ' - ' + ufNat : ''}` : undefined,
        telefonePrincipal: get('telefonePrincipal'),
        telefoneSecundario: get('telefoneSecundario'),
        email: emailValido(email) ? email : undefined,
        endereco: get('endereco'),
        bairro: get('bairro'),
        cidade: get('cidade'),
        estado: get('estado'),
        cep: get('cep'),
        formacao,
        formacaoOutro,
        empresa: get('empresa'),
        dataAdmissao: da && da !== 'INVALIDA' ? da.toISOString() : null,
        situacao: mapearSituacao(row[colunaPorCampo['situacao']]),
        dataFiliacao: df && df !== 'INVALIDA' ? df.toISOString() : null,
      };

      if (valido) validos++;
      else comErro++;
      if (duplicadoNoSistema) duplicados++;

      linhas.push({
        importacaoId: importacao.id,
        linha: numLinha,
        dados: dados as unknown as Prisma.InputJsonValue,
        nome,
        cpf: cpf || null,
        matricula,
        telefone: dados.telefonePrincipal,
        empresa: dados.empresa,
        situacao: dados.situacao,
        valido,
        duplicadoNoSistema,
        erros: erros as unknown as Prisma.InputJsonValue,
        avisos: avisos as unknown as Prisma.InputJsonValue,
        codigos,
      });
    });

    // Persiste as linhas em lote
    for (let i = 0; i < linhas.length; i += CHUNK) {
      await this.prisma.importacaoLinha.createMany({ data: linhas.slice(i, i + CHUNK) });
    }

    const atualizada = await this.prisma.importacao.update({
      where: { id: importacao.id },
      data: { status: StatusImportacao.VALIDADO, validos, comErro, duplicados },
    });

    return atualizada;
  }

  // --------------------------------------------------------------------------
  // Progresso / prévia
  // --------------------------------------------------------------------------
  async obterProgresso(id: string) {
    const imp = await this.prisma.importacao.findUnique({ where: { id } });
    if (!imp) throw new NotFoundException('Importação não encontrada');
    return imp;
  }

  async listarLinhas(
    id: string,
    params: { busca?: string; status?: 'validos' | 'erros' | 'duplicados'; page?: number },
  ) {
    const page = Number(params.page) || 1;
    const pageSize = 20;
    const where: Prisma.ImportacaoLinhaWhereInput = { importacaoId: id };
    if (params.status === 'validos') where.valido = true;
    if (params.status === 'erros') where.valido = false;
    if (params.status === 'duplicados') where.duplicadoNoSistema = true;
    if (params.busca) {
      where.OR = [
        { nome: { contains: params.busca, mode: 'insensitive' } },
        { cpf: { contains: params.busca.replace(/\D/g, '') } },
        { matricula: { contains: params.busca, mode: 'insensitive' } },
        { empresa: { contains: params.busca, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.importacaoLinha.findMany({
        where,
        orderBy: { linha: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.importacaoLinha.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Resumo de problemas por tipo (erros vermelho × avisos âmbar), para priorizar. */
  async resumoValidacao(id: string) {
    const linhas = await this.prisma.importacaoLinha.findMany({
      where: { importacaoId: id },
      select: { codigos: true },
    });
    const tally = new Map<string, number>();
    for (const l of linhas) for (const c of l.codigos) tally.set(c, (tally.get(c) ?? 0) + 1);

    const ERRO_CODES = new Set(['NOME_AUSENTE', 'CPF_INVALIDO', 'CPF_DUP_ARQUIVO']);
    const erros: { codigo: string; label: string; total: number }[] = [];
    const avisos: { codigo: string; label: string; total: number }[] = [];
    for (const [codigo, total] of tally) {
      const item = { codigo, label: CODIGO_LABEL[codigo] ?? codigo, total };
      (ERRO_CODES.has(codigo) ? erros : avisos).push(item);
    }
    erros.sort((a, b) => b.total - a.total);
    avisos.sort((a, b) => b.total - a.total);
    return { erros, avisos };
  }

  /** Recalcula os contadores agregados da importação (após edição/reclassificação). */
  private async recomputarContadores(id: string) {
    const [validos, comErro, duplicados] = await this.prisma.$transaction([
      this.prisma.importacaoLinha.count({ where: { importacaoId: id, valido: true } }),
      this.prisma.importacaoLinha.count({ where: { importacaoId: id, valido: false } }),
      this.prisma.importacaoLinha.count({ where: { importacaoId: id, duplicadoNoSistema: true } }),
    ]);
    await this.prisma.importacao.update({ where: { id }, data: { validos, comErro, duplicados } });
  }

  /** Edita uma linha da prévia e a revalida (correção no próprio app). */
  async editarLinha(
    importacaoId: string,
    linhaId: string,
    edits: Partial<{
      cpf: string;
      nomeCompleto: string;
      matricula: string;
      telefonePrincipal: string;
      email: string;
      empresa: string;
      situacao: string;
    }>,
  ) {
    const linha = await this.prisma.importacaoLinha.findFirst({
      where: { id: linhaId, importacaoId },
    });
    if (!linha) throw new NotFoundException('Linha não encontrada');
    const imp = await this.prisma.importacao.findUnique({ where: { id: importacaoId } });
    if (
      imp &&
      ([StatusImportacao.IMPORTANDO, StatusImportacao.CONCLUIDO] as StatusImportacao[]).includes(
        imp.status,
      )
    )
      throw new BadRequestException('Importação já iniciada — não é possível editar.');

    const dados = { ...(linha.dados as unknown as DadosNormalizados) };
    if (edits.nomeCompleto !== undefined) dados.nomeCompleto = limpar(edits.nomeCompleto);
    if (edits.matricula !== undefined) dados.matricula = limpar(edits.matricula);
    if (edits.telefonePrincipal !== undefined) dados.telefonePrincipal = limpar(edits.telefonePrincipal);
    if (edits.empresa !== undefined) dados.empresa = limpar(edits.empresa);
    if (edits.situacao !== undefined) dados.situacao = mapearSituacao(edits.situacao);
    if (edits.email !== undefined) dados.email = limpar(edits.email);

    // Normaliza CPF
    const cpfBruto = limparCpf(edits.cpf !== undefined ? edits.cpf : dados.cpf);
    const semCpf = cpfVazioOuPlaceholder(cpfBruto);
    const cpf = semCpf ? '' : cpfBruto;
    dados.cpf = cpf;

    const nome = dados.nomeCompleto;
    const matricula = dados.matricula;

    const erros: string[] = [];
    const avisos: string[] = [];
    const codigos: string[] = [];

    if (!nome) { erros.push('Nome em branco — preencha o nome do filiado.'); codigos.push('NOME_AUSENTE'); }
    if (!semCpf && !cpfValido(cpf)) {
      erros.push(
        cpf.length !== 11
          ? `CPF com ${cpf.length} dígito(s) — esperado 11.`
          : 'CPF inválido — dígito verificador não confere (provável erro de digitação na origem).',
      );
      codigos.push('CPF_INVALIDO');
    }

    if (cpf) {
      const outra = await this.prisma.importacaoLinha.findFirst({
        where: { importacaoId, cpf, id: { not: linhaId } },
        orderBy: { linha: 'asc' },
        select: { linha: true },
      });
      if (outra) { erros.push(`CPF repetido no arquivo — igual ao da linha ${outra.linha}.`); codigos.push('CPF_DUP_ARQUIVO'); }
    }
    if (matricula) {
      const outra = await this.prisma.importacaoLinha.findFirst({
        where: { importacaoId, matricula, id: { not: linhaId } },
        orderBy: { linha: 'asc' },
        select: { linha: true },
      });
      if (outra) { avisos.push(`Matrícula ${matricula} repetida no arquivo (linha ${outra.linha}).`); codigos.push('MATRICULA_DUP_ARQUIVO'); }
    }
    if (dados.email && !emailValido(dados.email)) { avisos.push(`E-mail inválido ("${dados.email}") — ignorado.`); codigos.push('EMAIL_INVALIDO'); dados.email = undefined; }
    if (semCpf) { avisos.push('Sem CPF — será importado sem CPF.'); codigos.push('SEM_CPF'); }

    let duplicadoNoSistema = false;
    if (cpf) {
      const f = await this.prisma.filiado.findUnique({ where: { cpf }, select: { matricula: true, nomeCompleto: true } });
      if (f) { avisos.push(`CPF já cadastrado no sistema — matrícula ${f.matricula}, ${f.nomeCompleto}.`); codigos.push('DUP_SISTEMA_CPF'); duplicadoNoSistema = true; }
    } else if (semCpf && matricula) {
      const f = await this.prisma.filiado.findFirst({ where: { matricula }, select: { nomeCompleto: true } });
      if (f) { avisos.push(`Matrícula ${matricula} já existe no sistema (${f.nomeCompleto}).`); codigos.push('DUP_SISTEMA_MATRICULA'); duplicadoNoSistema = true; }
    }

    const valido = erros.length === 0;
    const atualizada = await this.prisma.importacaoLinha.update({
      where: { id: linhaId },
      data: {
        dados: dados as unknown as Prisma.InputJsonValue,
        nome,
        cpf: cpf || null,
        matricula,
        telefone: dados.telefonePrincipal,
        empresa: dados.empresa,
        situacao: dados.situacao,
        valido,
        duplicadoNoSistema,
        erros: erros as unknown as Prisma.InputJsonValue,
        avisos: avisos as unknown as Prisma.InputJsonValue,
        codigos,
      },
    });
    await this.recomputarContadores(importacaoId);
    return atualizada;
  }

  // --------------------------------------------------------------------------
  // Etapa 5: confirmação + execução em lote (assíncrona)
  // --------------------------------------------------------------------------
  async confirmar(
    id: string,
    dto: {
      estrategia?: EstrategiaDuplicado;
      estrategiaMatricula?: EstrategiaMatricula;
      importarSomenteValidos?: boolean;
      permitirCpfInvalido?: boolean;
    },
    ctx: { userId?: string; ip?: string },
  ) {
    let imp = await this.prisma.importacao.findUnique({ where: { id } });
    if (!imp) throw new NotFoundException('Importação não encontrada');
    if (imp.status === StatusImportacao.IMPORTANDO)
      throw new BadRequestException('Importação já está em andamento');
    if (imp.status === StatusImportacao.CONCLUIDO)
      throw new BadRequestException('Importação já concluída');

    // Opção: importar CPFs inválidos — libera as linhas cujo único bloqueio é o dígito verificador
    if (dto.permitirCpfInvalido) {
      await this.liberarCpfInvalido(id);
      await this.recomputarContadores(id);
      imp = (await this.prisma.importacao.findUnique({ where: { id } }))!;
    }

    if (imp.comErro > 0 && !dto.importarSomenteValidos)
      throw new BadRequestException(
        `Existem ${imp.comErro} registro(s) com erro. Corrija o arquivo ou confirme "importar somente válidos".`,
      );

    const estrategia = dto.estrategia ?? EstrategiaDuplicado.IGNORAR;
    const estrategiaMatricula = dto.estrategiaMatricula ?? EstrategiaMatricula.REGENERAR;
    await this.prisma.importacao.update({
      where: { id },
      data: {
        status: StatusImportacao.IMPORTANDO,
        estrategia,
        estrategiaMatricula,
        permitirCpfInvalido: dto.permitirCpfInvalido ?? false,
        iniciadoEm: new Date(),
        processados: 0,
        importados: 0,
        atualizados: 0,
        ignorados: 0,
        dispensados: 0,
      },
    });

    // Executa em background; o frontend acompanha via obterProgresso()
    void this.executar(id, estrategia, estrategiaMatricula, ctx).catch(async (e) => {
      this.logger.error(`Falha na importação ${id}: ${e?.message}`);
      await this.prisma.importacao.update({
        where: { id },
        data: { status: StatusImportacao.ERRO, erroMensagem: String(e?.message ?? e) },
      });
    });

    return { ok: true, status: StatusImportacao.IMPORTANDO };
  }

  /**
   * Libera para importação as linhas cujo ÚNICO motivo de bloqueio é o CPF inválido
   * (move a mensagem de erro para aviso e marca como válida). CPF duplicado no arquivo
   * e nome ausente continuam bloqueando.
   */
  private async liberarCpfInvalido(id: string) {
    const BLOQUEANTES = new Set(['NOME_AUSENTE', 'CPF_DUP_ARQUIVO']);
    const candidatas = await this.prisma.importacaoLinha.findMany({
      where: { importacaoId: id, valido: false },
      select: { id: true, codigos: true, erros: true, avisos: true },
    });
    for (const l of candidatas) {
      const temCpfInvalido = l.codigos.includes('CPF_INVALIDO');
      const outrosBloqueios = l.codigos.some((c) => BLOQUEANTES.has(c));
      if (!temCpfInvalido || outrosBloqueios) continue;

      const errosAtuais = (l.erros as unknown as string[]) ?? [];
      const avisosAtuais = (l.avisos as unknown as string[]) ?? [];
      const novosAvisos = [
        ...avisosAtuais,
        ...errosAtuais, // a(s) mensagem(ns) de CPF inválido viram aviso
        'CPF inválido importado mesmo assim (autorizado na importação).',
      ];
      await this.prisma.importacaoLinha.update({
        where: { id: l.id },
        data: {
          valido: true,
          erros: [] as unknown as Prisma.InputJsonValue,
          avisos: novosAvisos as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  private async executar(
    id: string,
    estrategia: EstrategiaDuplicado,
    estrategiaMatricula: EstrategiaMatricula,
    ctx: { userId?: string; ip?: string },
  ) {
    const inicio = Date.now();

    // Base para gerar matrículas/números de carteirinha sequenciais
    let seqFiliado = await this.prisma.filiado.count();
    let seqCarteira = await this.prisma.carteirinha.count();
    const ano = new Date().getFullYear();
    // Matrículas já usadas (no sistema + as criadas durante esta importação) — garante unicidade
    const usadas = new Set(
      (await this.prisma.filiado.findMany({ select: { matricula: true } })).map((f) => f.matricula),
    );

    let processados = 0;
    let importados = 0;
    let atualizados = 0;
    let ignorados = 0;
    let dispensados = 0;
    let comErro = 0;

    let cursor: string | undefined;
    // Itera apenas linhas válidas, em páginas por cursor
    for (;;) {
      const lote = await this.prisma.importacaoLinha.findMany({
        where: { importacaoId: id, valido: true },
        orderBy: { id: 'asc' },
        take: CHUNK,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (lote.length === 0) break;
      cursor = lote[lote.length - 1].id;

      for (const linha of lote) {
        const d = linha.dados as unknown as DadosNormalizados;
        try {
          if (linha.duplicadoNoSistema) {
            if (estrategia === EstrategiaDuplicado.IGNORAR) {
              ignorados++;
              await this.marcarLinha(linha.id, 'IGNORADO');
            } else {
              const fid = await this.atualizarExistente(d, ctx.userId);
              atualizados++;
              await this.marcarLinha(linha.id, 'ATUALIZADO', fid);
            }
          } else {
            // matrícula única: usa a do arquivo se livre; senão aplica a estratégia escolhida
            let matricula = d.matricula?.trim();
            const colide = !!matricula && usadas.has(matricula);

            if (colide && estrategiaMatricula === EstrategiaMatricula.DISPENSAR) {
              // Dispensa a pessoa (não importa) por conflito de matrícula
              dispensados++;
              await this.marcarLinha(linha.id, 'DISPENSADO');
            } else {
              if (!matricula || colide) {
                do {
                  matricula = `SEN-${ano}-${String(++seqFiliado).padStart(6, '0')}`;
                } while (usadas.has(matricula));
              }
              usadas.add(matricula);
              const fid = await this.criarFiliado(d, matricula, () =>
                `CART-${ano}-${String(++seqCarteira).padStart(6, '0')}`,
                id,
              );
              importados++;
              await this.marcarLinha(linha.id, 'IMPORTADO', fid);
            }
          }
        } catch (e: any) {
          // Conflito de matrícula/cpf concorrente: gera nova matrícula e tenta 1x
          comErro++;
          await this.marcarLinha(linha.id, 'ERRO');
          this.logger.warn(`Linha ${linha.linha} falhou: ${e?.message}`);
        }
        processados++;
      }

      await this.prisma.importacao.update({
        where: { id },
        data: { processados, importados, atualizados, ignorados, dispensados, comErro },
      });
    }

    const duracaoMs = Date.now() - inicio;
    await this.prisma.importacao.update({
      where: { id },
      data: {
        status: StatusImportacao.CONCLUIDO,
        finalizadoEm: new Date(),
        duracaoMs,
        processados,
        importados,
        atualizados,
        ignorados,
        dispensados,
        comErro,
      },
    });

    await this.audit.registrar({
      userId: ctx.userId,
      acao: AcaoAuditoria.IMPORT,
      entidade: 'Importacao',
      entidadeId: id,
      ip: ctx.ip,
      descricao: `Importação concluída: ${importados} criados, ${atualizados} atualizados, ${ignorados} ignorados, ${dispensados} dispensados, ${comErro} com erro.`,
      metadata: { importados, atualizados, ignorados, dispensados, comErro, duracaoMs },
    });
  }

  private async marcarLinha(linhaId: string, resultado: string, filiadoId?: string) {
    await this.prisma.importacaoLinha.update({
      where: { id: linhaId },
      data: { resultado, filiadoId },
    });
  }

  private dadosFiliado(d: DadosNormalizados) {
    return {
      nomeCompleto: d.nomeCompleto ?? 'SEM NOME',
      cpf: d.cpf || null, // sem CPF → null (índice único permite múltiplos null)
      rg: d.rg,
      dataNascimento: d.dataNascimento ? new Date(d.dataNascimento) : null,
      sexo: (d.sexo as any) ?? null,
      estadoCivil: (d.estadoCivil as any) ?? null,
      naturalidade: d.naturalidade,
      telefonePrincipal: d.telefonePrincipal,
      telefoneSecundario: d.telefoneSecundario,
      email: d.email,
      endereco: d.endereco,
      bairro: d.bairro,
      cidade: d.cidade,
      estado: d.estado,
      cep: d.cep,
      formacao: d.formacao as any,
      formacaoOutro: d.formacaoOutro ?? undefined,
      dataAdmissao: d.dataAdmissao ? new Date(d.dataAdmissao) : null,
      situacao: d.situacao,
    };
  }

  private async criarFiliado(
    d: DadosNormalizados,
    matricula: string,
    proximoNumeroCarteira: () => string,
    importacaoId: string,
  ): Promise<string> {
    const base = this.dadosFiliado(d);
    const dataFiliacao = d.dataFiliacao ? new Date(d.dataFiliacao) : undefined;
    const ativo = d.situacao === SituacaoFiliado.ATIVO;

    const filiado = await this.prisma.filiado.create({
      data: {
        ...base,
        matricula,
        qrToken: this.qr.gerarToken(),
        aprovadoEm: ativo ? (dataFiliacao ?? new Date()) : undefined,
        createdAt: dataFiliacao, // preserva a data de filiação legada
        vinculos: d.empresa ? { create: [{ empresa: d.empresa, ordem: 1 }] } : undefined,
        // Carteirinha automática para filiados ativos
        carteirinha: ativo
          ? {
              create: {
                numero: proximoNumeroCarteira(),
                validaAte: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                status: StatusCarteirinha.ATIVA,
              },
            }
          : undefined,
        historico: {
          create: {
            tipo: TipoHistoricoFiliado.FILIACAO,
            descricao: 'Filiado importado do sistema legado.',
            autor: 'Importação CSV',
            metadata: { importacaoId } as Prisma.InputJsonValue,
          },
        },
      },
    });
    return filiado.id;
  }

  private async atualizarExistente(d: DadosNormalizados, userId?: string): Promise<string> {
    // Identifica o existente por CPF quando há; senão por matrícula (caso "sem CPF")
    const existente = d.cpf
      ? await this.prisma.filiado.findUnique({ where: { cpf: d.cpf } })
      : d.matricula
        ? await this.prisma.filiado.findFirst({ where: { matricula: d.matricula } })
        : null;
    if (!existente) {
      // Caso raro: deixou de existir entre validação e importação → cria
      const ano = new Date().getFullYear();
      const total = await this.prisma.filiado.count();
      return this.criarFiliado(d, `SEN-${ano}-${String(total + 1).padStart(6, '0')}`, () =>
        `CART-${ano}-${String(total + 1).padStart(6, '0')}`,
        'recriado',
      );
    }
    const base = this.dadosFiliado(d);
    // Não sobrescreve com vazio: mantém o que já existe quando o CSV vier em branco
    const data: Prisma.FiliadoUpdateInput = {};
    for (const [k, v] of Object.entries(base)) {
      if (v !== undefined && v !== null && v !== '') (data as any)[k] = v;
    }
    await this.prisma.$transaction([
      this.prisma.filiado.update({ where: { id: existente.id }, data }),
      this.prisma.filiadoHistorico.create({
        data: {
          filiadoId: existente.id,
          tipo: TipoHistoricoFiliado.RECADASTRAMENTO,
          descricao: 'Cadastro atualizado via importação CSV.',
          autor: 'Importação CSV',
        },
      }),
    ]);
    return existente.id;
  }
}
