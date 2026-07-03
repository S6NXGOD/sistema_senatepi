import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SituacaoFiliado,
  TipoDocumento,
  TipoHistoricoFiliado,
  TipoPessoa,
} from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageService } from '../../common/storage/image.service';
import { StorageService } from '../../common/storage/storage.service';
import { QrCodeService } from '../../common/qrcode/qrcode.service';
import { gerarMatricula, mascararCpf } from '../../common/utils/matricula.util';
import {
  calcularIdade,
  dependenteValidoParaEvento,
} from '../dependentes/dependentes.module';
import {
  ChangeSituacaoDto,
  CreateFiliadoDto,
  ListFiliadosQueryDto,
  UpdateFiliadoDto,
} from './dto/filiado.dto';

const MIME_PERMITIDOS: Record<string, true> = {
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'image/jpeg': true,
  'image/png': true,
};

const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';

@Injectable()
export class FiliadosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly image: ImageService,
    private readonly storage: StorageService,
    private readonly qr: QrCodeService,
  ) {}

  async registrarHistorico(
    filiadoId: string,
    tipo: TipoHistoricoFiliado,
    descricao: string,
    autor?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.prisma.filiadoHistorico.create({
      data: { filiadoId, tipo, descricao, autor, metadata },
    });
  }

  async create(dto: CreateFiliadoDto, autor?: string) {
    const cpf = dto.cpf.replace(/\D/g, '');
    if (await this.prisma.filiado.findUnique({ where: { cpf } }))
      throw new BadRequestException('Já existe filiado com este CPF');

    const total = await this.prisma.filiado.count();
    const { vinculos, ...dados } = dto;

    const filiado = await this.prisma.filiado.create({
      data: {
        ...dados,
        cpf,
        dataNascimento: new Date(dto.dataNascimento),
        dataAdmissao: dto.dataAdmissao ? new Date(dto.dataAdmissao) : undefined,
        matricula: gerarMatricula('SEN', total + 1),
        qrToken: this.qr.gerarToken(),
        vinculos: vinculos
          ? { create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })) }
          : undefined,
      },
      include: { vinculos: true },
    });

    await this.registrarHistorico(
      filiado.id,
      TipoHistoricoFiliado.FILIACAO,
      'Filiação registrada.',
      autor,
    );
    return filiado;
  }

  async findAll(query: ListFiliadosQueryDto) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    // CPF sempre por prefixo (só dígitos), respeitando máscara ou não.
    const buscaDigitos = query.busca ? query.busca.replace(/\D/g, '') : '';

    const where: Prisma.FiliadoWhereInput = {
      situacao: query.situacao,
      nomeCompleto: query.nome ? { contains: query.nome, mode: 'insensitive' } : undefined,
      cpf: query.cpf ? { startsWith: query.cpf.replace(/\D/g, '') } : undefined,
      numeroCoren: query.coren ? { contains: query.coren, mode: 'insensitive' } : undefined,
      cidade: query.cidade ? { contains: query.cidade, mode: 'insensitive' } : undefined,
      createdAt:
        query.dataInicio || query.dataFim
          ? {
              gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
              lte: query.dataFim ? new Date(query.dataFim + 'T23:59:59') : undefined,
            }
          : undefined,
      // Busca unificada: nome (contém), matrícula (contém) e CPF (começa com — só dígitos)
      OR: query.busca
        ? [
            { nomeCompleto: { contains: query.busca, mode: 'insensitive' } },
            { matricula: { contains: query.busca, mode: 'insensitive' } },
            ...(buscaDigitos ? [{ cpf: { startsWith: buscaDigitos } }] : []),
          ]
        : undefined,
    };

    const [registros, total] = await this.prisma.$transaction([
      this.prisma.filiado.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { dependentes: true } } },
      }),
      this.prisma.filiado.count({ where }),
    ]);

    const data = await Promise.all(
      registros.map(async (f) => ({
        ...f,
        fotoUrl: f.fotoThumbKey
          ? await this.storage.getSignedUrl(f.fotoThumbKey).catch(() => null)
          : null,
      })),
    );

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Filiados com CPF duplicado. Agrupa por CPF (`groupBy`) contando ocorrências
   * e mantém apenas os grupos com mais de um registro (`_count.cpf > 1`); em
   * seguida devolve os filiados desses grupos, ordenados por CPF para exibir os
   * duplicados lado a lado na tabela.
   */
  async duplicados() {
    const grupos = await this.prisma.filiado.groupBy({
      by: ['cpf'],
      where: { cpf: { not: null } },
      _count: { cpf: true },
      having: { cpf: { _count: { gt: 1 } } },
    });

    const cpfs = grupos.map((g) => g.cpf).filter((c): c is string => Boolean(c));
    if (cpfs.length === 0) return { data: [], total: 0, grupos: 0 };

    const registros = await this.prisma.filiado.findMany({
      where: { cpf: { in: cpfs } },
      orderBy: [{ cpf: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { dependentes: true } } },
    });

    const data = await Promise.all(
      registros.map(async (f) => ({
        ...f,
        fotoUrl: f.fotoThumbKey
          ? await this.storage.getSignedUrl(f.fotoThumbKey).catch(() => null)
          : null,
      })),
    );

    // total = registros duplicados; grupos = quantidade de CPFs repetidos.
    return { data, total: data.length, grupos: cpfs.length };
  }

  /**
   * Autocomplete do cadastro legado de Filiados para telas administrativas —
   * ex.: alocação manual da Colônia. Busca por nome (contém) ou CPF (prefixo, só
   * dígitos). Retorna o PERFIL COMPLETO (para preencher a reserva sem redigitação):
   * nome, CPF, COREN, formação, e-mail, telefone, cidade, estado e vínculos/locais
   * de trabalho. Máx. 10 resultados.
   */
  async buscarParaAutocomplete(q: string) {
    const termo = (q ?? '').trim();
    if (termo.length < 2) return [];
    const digitos = termo.replace(/\D/g, '');

    // Mapeia a formação do cadastro legado para o enum da Colônia (ENF/TEC/AUX).
    const MAP_FORMACAO: Record<string, 'ENFERMEIRO' | 'TECNICO' | 'AUXILIAR' | null> = {
      ENFERMEIRO: 'ENFERMEIRO',
      TECNICO_ENFERMAGEM: 'TECNICO',
      AUXILIAR_ENFERMAGEM: 'AUXILIAR',
      OUTRO: null,
    };

    const filiados = await this.prisma.filiado.findMany({
      where: {
        OR: [
          { nomeCompleto: { contains: termo, mode: 'insensitive' } },
          ...(digitos ? [{ cpf: { startsWith: digitos } }] : []),
        ],
      },
      select: {
        id: true,
        nomeCompleto: true,
        cpf: true,
        numeroCoren: true,
        formacao: true,
        email: true,
        telefonePrincipal: true,
        cidade: true,
        estado: true,
        vinculos: {
          select: { empresa: true, cargo: true, ordem: true },
          orderBy: { ordem: 'asc' },
        },
      },
      orderBy: { nomeCompleto: 'asc' },
      take: 10,
    });

    return filiados.map((f) => ({
      id: f.id,
      nome: f.nomeCompleto,
      cpf: f.cpf,
      cpfMascarado: mascararCpf(f.cpf),
      coren: f.numeroCoren,
      // Só os dígitos do COREN (o sufixo -ENF/-TE/-AE é derivado da formação no front).
      corenNumero: f.numeroCoren ? f.numeroCoren.replace(/\D/g, '').slice(0, 6) || null : null,
      formacao: f.formacao ? MAP_FORMACAO[f.formacao] ?? null : null,
      email: f.email,
      telefone: f.telefonePrincipal,
      cidade: f.cidade,
      estado: f.estado,
      // Locais de trabalho a partir dos vínculos (ordenados).
      localTrabalho1: f.vinculos[0]?.empresa ?? null,
      localTrabalho2: f.vinculos[1]?.empresa ?? null,
      vinculos: f.vinculos.map((v) => ({ empresa: v.empresa, cargo: v.cargo })),
    }));
  }

  async findOne(id: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id },
      include: { vinculos: { orderBy: { ordem: 'asc' } }, dependentes: true, carteirinha: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');
    return filiado;
  }

  /** Perfil completo com tudo que a tela de perfil precisa. */
  async perfil(id: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        dependentes: { orderBy: { createdAt: 'asc' } },
        carteirinha: true,
        documentos: { orderBy: { createdAt: 'desc' } },
        historico: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');

    const fotoUrl = filiado.fotoKey
      ? await this.storage.getSignedUrl(filiado.fotoKey).catch(() => null)
      : null;

    const dependentes = await Promise.all(
      filiado.dependentes.map(async (d) => ({
        ...d,
        idade: calcularIdade(d.dataNascimento),
        validoParaEvento: dependenteValidoParaEvento(d.tipo, d.dataNascimento),
        fotoUrl: d.fotoThumbKey
          ? await this.storage.getSignedUrl(d.fotoThumbKey).catch(() => null)
          : null,
      })),
    );

    const todosDocs = await Promise.all(
      filiado.documentos.map(async (d) => ({
        ...d,
        url: await this.storage.getSignedUrl(d.storageKey).catch(() => null),
      })),
    );
    const documentos = todosDocs.filter((d) => d.tipo !== TipoDocumento.TERMO_CONSENTIMENTO);
    const termos = todosDocs.filter((d) => d.tipo === TipoDocumento.TERMO_CONSENTIMENTO);

    return { ...filiado, fotoUrl, dependentes, documentos, termos };
  }

  async update(id: string, dto: UpdateFiliadoDto, autor?: string) {
    await this.findOne(id);
    const { vinculos, ...dados } = dto;

    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        ...dados,
        cpf: dto.cpf ? dto.cpf.replace(/\D/g, '') : undefined,
        dataNascimento: dto.dataNascimento ? new Date(dto.dataNascimento) : undefined,
        dataAdmissao: dto.dataAdmissao ? new Date(dto.dataAdmissao) : undefined,
        // Substitui os vínculos quando enviados
        vinculos: vinculos
          ? {
              deleteMany: {},
              create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })),
            }
          : undefined,
      },
      include: { vinculos: true },
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.ALTERACAO,
      'Dados cadastrais atualizados.',
      autor,
      { campos: Object.keys(dados) },
    );
    return filiado;
  }

  async changeSituacao(id: string, dto: ChangeSituacaoDto, autor?: string) {
    const atual = await this.findOne(id);
    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        situacao: dto.situacao,
        aprovadoEm:
          dto.situacao === SituacaoFiliado.ATIVO && !atual.aprovadoEm
            ? new Date()
            : undefined,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.MUDANCA_STATUS,
      `Situação alterada de ${atual.situacao} para ${dto.situacao}.${dto.motivo ? ' Motivo: ' + dto.motivo : ''}`,
      autor,
    );
    return filiado;
  }

  /**
   * Desfiliação: marca a situação como DESFILIADO. O filiado deixa de ser aceito
   * em eventos e na Colônia de Férias (validado nos respectivos serviços), mas o
   * cadastro é preservado. Idempotente-seguro: bloqueia se já estiver desfiliado.
   */
  async desfiliar(id: string, autor?: string) {
    const atual = await this.findOne(id);
    if (atual.situacao === SituacaoFiliado.DESFILIADO)
      throw new BadRequestException('Este filiado já está desfiliado.');

    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: { situacao: SituacaoFiliado.DESFILIADO },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.MUDANCA_STATUS,
      `Filiado desfiliado (situação alterada de ${atual.situacao} para DESFILIADO).`,
      autor,
    );
    return filiado;
  }

  /** Exclusão permanente do cadastro (LGPD — Lei nº 13.709/2018). */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.filiado.delete({ where: { id } });
    return { ok: true };
  }

  async atualizarFoto(id: string, arquivo: Buffer, autor?: string) {
    const filiado = await this.findOne(id);
    const { fotoKey, fotoThumbKey } = await this.image.processarFoto(
      arquivo,
      `filiados/${id}`,
    );
    if (filiado.fotoKey) void this.storage.delete(filiado.fotoKey).catch(() => undefined);
    if (filiado.fotoThumbKey) void this.storage.delete(filiado.fotoThumbKey).catch(() => undefined);
    const atualizado = await this.prisma.filiado.update({
      where: { id },
      data: { fotoKey, fotoThumbKey },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.ALTERACAO,
      'Foto do filiado atualizada.',
      autor,
    );
    return atualizado;
  }

  // ---- Documentos ----
  async addDocumento(
    id: string,
    arquivo: Express.Multer.File,
    titulo: string,
    autor?: string,
  ) {
    await this.findOne(id);
    if (!MIME_PERMITIDOS[arquivo.mimetype])
      throw new BadRequestException('Formato não permitido. Use PDF, DOC, DOCX, JPG ou PNG.');

    const ext = arquivo.originalname.split('.').pop() ?? 'bin';
    const storageKey = `filiados/${id}/documentos/${Date.now()}.${ext}`;
    await this.storage.upload(storageKey, arquivo.buffer, arquivo.mimetype);

    const documento = await this.prisma.documento.create({
      data: {
        tipo: TipoDocumento.DOCUMENTO_PESSOAL,
        titulo: titulo || arquivo.originalname,
        storageKey,
        mimeType: arquivo.mimetype,
        tamanhoBytes: arquivo.size,
        filiadoId: id,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.UPLOAD_DOCUMENTO,
      `Documento anexado: ${documento.titulo}.`,
      autor,
    );
    return documento;
  }

  async removeDocumento(filiadoId: string, documentoId: string) {
    const doc = await this.prisma.documento.findFirst({
      where: { id: documentoId, filiadoId },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    void this.storage.delete(doc.storageKey).catch(() => undefined);
    await this.prisma.documento.delete({ where: { id: documentoId } });
    return { ok: true };
  }

  // ---- QR Code ----
  async qrCode(id: string) {
    const filiado = await this.findOne(id);
    const payload = this.qr.montarPayload(filiado.id, TipoPessoa.FILIADO, filiado.qrToken);
    return { payload, imagem: await this.qr.gerarImagemDataUrl(payload) };
  }

  // ---- Histórico ----
  async historico(id: string) {
    await this.findOne(id);
    return this.prisma.filiadoHistorico.findMany({
      where: { filiadoId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- Termo de Consentimento e Filiação (PDF) ----
  async gerarTermoPdf(id: string, autor?: string): Promise<Buffer> {
    const f = await this.findOne(id);

    // Textos legais fixos (inseridos exatamente como definidos pela diretoria).
    const TEXTO_DESCONTO =
      'O Enfermeiro, Auxiliar em enfermagem e Técnico em enfermagem, abaixo assinado, autoriza as ' +
      'instituições públicas da administração direta, indireta, funcional e privada, ao qual tenha vínculo ' +
      'como Servidor Público, Empregado Público e Empregado, respectivamente, a descontar em folha de ' +
      'pagamento / contracheque, em favor do SENATEPI, na AG: 2004; OP: 003; C/C 1341-4 BANCO: CEF. A ' +
      'contribuição associativa mensal no valor de 1% sobre o maior vencimento básico ao qual esteja ' +
      'vinculado, em conformidade com os Art.: 57, §1º do estatuto do SENATEPI e Art.: 584, alínea b, da ' +
      'CLT. Solicito que a Contribuição Sindical (Imposto Sindical) de que trata o Art.: 579 da CLT sejam ' +
      'repassadas ao sindicato supra na referida conta da Entidade Sindical Representativa da Categoria ' +
      'Base Territorial do Estado do Piauí Fundado em 30/11/2009 - Registro no Mtb/ sob nº ' +
      '46214.0005793/2018-86; Código da Entidade Sindical nº 19020-7 - CNPJ 11.378.331/0001-86.';
    const TEXTO_LGPD =
      'Em observância à Lei nº. 13.709/18 - Lei Geral de Proteção de Dados Pessoais (Fonte: Diário Oficial ' +
      'da União) e demais normativas aplicáveis sobre proteção de Dados Pessoais, manifesto-me de forma, ' +
      'livre, expressa e consciente, no sentido de autorizar o SENATEPI a realizar o tratamento de meus ' +
      'dados pessoais SEMPRE QUE FOR SOLICITADO. Consinto, ainda, com a utilização destes dados para as ' +
      'finalidades de representação sindical, emissão de carteirinha, controle de eventos e acesso a benefícios.';
    const RODAPE =
      'DIRETORIA SENATEPI - RUA LUCÍDIO FREITAS, Nº.1070, CENTRO-NORTE, TERESINA-PI, CEP: 64000-440 | ' +
      'CONTATOS: (86) 3303-1426; (86) 99421-1117; e-mail: senatepienfermagem@outlook.com';

    const SEXO_LABEL: Record<string, string> = {
      MASCULINO: 'Masculino', FEMININO: 'Feminino', OUTRO: 'Outro',
    };
    const EC_LABEL: Record<string, string> = {
      SOLTEIRO: 'Solteiro(a)', CASADO: 'Casado(a)', DIVORCIADO: 'Divorciado(a)',
      VIUVO: 'Viúvo(a)', UNIAO_ESTAVEL: 'União estável', OUTRO: 'Outro',
    };
    const FORM_LABEL: Record<string, string> = {
      ENFERMEIRO: 'Enfermeiro(a)', TECNICO_ENFERMAGEM: 'Técnico(a) em Enfermagem',
      AUXILIAR_ENFERMAGEM: 'Auxiliar de Enfermagem', OUTRO: 'Outro',
    };

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const X = doc.page.margins.left;
      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const LINHA_VAZIA = '______________________';

      // Campo vazio (null/undefined) vira linha para preenchimento manual impresso.
      const ou = (v?: string | null) => {
        const s = v == null ? '' : String(v).trim();
        return s ? s : LINHA_VAZIA;
      };
      const fmt = (d?: Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : null);

      // Linha com um ou mais pares Rótulo (negrito) + valor (normal).
      const par = (pares: Array<[string, string]>) => {
        doc.fontSize(10.5);
        pares.forEach(([label, value], i) => {
          const last = i === pares.length - 1;
          doc.font('Times-Bold').fillColor('#111827').text(`${label}: `, { continued: true });
          doc.font('Times-Roman').fillColor('#1f2937').text(value, { continued: !last });
          if (!last) doc.font('Times-Roman').text('     ', { continued: true });
        });
        doc.moveDown(0.5);
      };

      // Título de seção com fundo cinza (aspecto de contrato).
      const secao = (titulo: string) => {
        doc.moveDown(0.7);
        if (doc.y > doc.page.height - 140) doc.addPage();
        const y = doc.y;
        doc.save().rect(X, y, W, 20).fill('#e5e7eb').restore();
        doc.fillColor('#111827').font('Times-Bold').fontSize(11).text(titulo, X + 8, y + 5.5, { width: W - 16 });
        doc.x = X;
        doc.y = y + 26;
        doc.font('Times-Roman').fillColor('#1f2937');
      };

      const subBloco = (titulo: string) => {
        doc.moveDown(0.15);
        doc.font('Times-Bold').fontSize(10).fillColor('#374151').text(titulo, X, doc.y);
        doc.moveDown(0.15);
        doc.fillColor('#1f2937');
      };

      const paragrafo = (texto: string) => {
        doc.font('Times-Roman').fontSize(10).fillColor('#1f2937')
          .text(texto, X, doc.y, { align: 'justify', width: W, lineGap: 1.5 });
        doc.moveDown(0.5);
      };

      // ---- Cabeçalho oficial (centralizado) ----
      doc.font('Times-Bold').fontSize(9.5).fillColor('#111827').text(
        'SENATEPI - SINDICATO DOS ENFERMEIROS, AUXILIARES E TÉCNICOS EM ENFERMAGEM DO ESTADO DO PIAUÍ | CNPJ: 11.378.331/0001-86',
        X, doc.page.margins.top, { align: 'center', width: W },
      );
      doc.moveDown(0.5);
      doc.font('Times-Bold').fontSize(14).fillColor(VERDE_ESCURO)
        .text('FICHA DE FILIAÇÃO E TERMO DE CONSENTIMENTO', { align: 'center', width: W });
      doc.moveDown(0.2);
      doc.font('Times-Roman').fontSize(8.5).fillColor('#6b7280')
        .text(`Matrícula sindical: ${f.matricula}`, { align: 'center', width: W });
      doc.moveDown(0.35);
      const yh = doc.y;
      doc.moveTo(X, yh).lineTo(X + W, yh).strokeColor(VERDE_ESCURO).lineWidth(1).stroke();
      doc.moveDown(0.3);

      // ---- SEÇÃO 1 — Informações pessoais e de contato ----
      secao('SEÇÃO 1 - INFORMAÇÕES PESSOAIS E DE CONTATO');
      par([['Nome', ou(f.nomeCompleto)]]);
      par([
        ['CPF', ou(f.cpf ? mascararCpf(f.cpf) : null)],
        ['RG', ou(f.rg ? `${f.rg}${f.ufRg ? ' / ' + f.ufRg : ''}` : null)],
        ['Data de Nascimento', ou(fmt(f.dataNascimento))],
      ]);
      par([
        ['Sexo', ou(f.sexo ? SEXO_LABEL[f.sexo] ?? f.sexo : null)],
        ['Estado Civil', ou(f.estadoCivil ? EC_LABEL[f.estadoCivil] ?? f.estadoCivil : null)],
        ['Naturalidade/UF', ou(f.naturalidade)],
      ]);
      par([['Endereço', ou(f.endereco)], ['Nº', ou(f.numero)], ['Complemento', ou(f.complemento)]]);
      par([['Bairro', ou(f.bairro)], ['Cidade', ou(f.cidade)], ['UF', ou(f.estado)], ['CEP', ou(f.cep)]]);
      par([['Telefone', ou(f.telefonePrincipal)], ['Telefone 2', ou(f.telefoneSecundario)]]);
      par([['E-mail', ou(f.email)]]);

      // ---- SEÇÃO 2 — Informações profissionais ----
      secao('SEÇÃO 2 - INFORMAÇÕES PROFISSIONAIS');
      const formacaoTexto =
        f.formacao === 'OUTRO'
          ? f.formacaoOutro || 'Outro'
          : f.formacao ? FORM_LABEL[f.formacao] ?? f.formacao : null;
      par([['Formação Profissional', ou(formacaoTexto)], ['Nº COREN', ou(f.numeroCoren)]]);

      const v1 = f.vinculos?.[0];
      const v2 = f.vinculos?.[1];
      subBloco('Instituição 1');
      par([['Instituição', ou(v1?.empresa)], ['Cargo', ou(v1?.cargo)]]);
      par([['Matrícula', ou(v1?.matricula)], ['Data de Admissão', ou(fmt(f.dataAdmissao))]]);
      subBloco('Instituição 2');
      par([['Instituição', ou(v2?.empresa)], ['Cargo', ou(v2?.cargo)]]);
      par([['Matrícula', ou(v2?.matricula)], ['Data de Admissão', ou(null)]]);

      // ---- SEÇÃO 3 — Autorização de desconto sindical ----
      secao('SEÇÃO 3 - AUTORIZAÇÃO DE DESCONTO SINDICAL');
      paragrafo(TEXTO_DESCONTO);

      // ---- SEÇÃO 4 — Consentimento e tratamento de dados (LGPD) ----
      secao('SEÇÃO 4 - CONSENTIMENTO E TRATAMENTO DE DADOS (LGPD)');
      paragrafo(TEXTO_LGPD);

      // ---- Data + assinatura ----
      doc.moveDown(1.4);
      const dataFmt = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
      doc.font('Times-Roman').fontSize(10.5).fillColor('#1f2937')
        .text(`Teresina/PI, ${dataFmt}.`, X, doc.y, { width: W });
      doc.moveDown(2.4);
      const ys = doc.y;
      doc.moveTo(X + 110, ys).lineTo(X + W - 110, ys).strokeColor('#374151').lineWidth(0.8).stroke();
      doc.font('Times-Roman').fontSize(10).fillColor('#111827')
        .text('Assinatura do(a) Filiado(a)', X, ys + 6, { align: 'center', width: W });

      // ---- Rodapé fixo (repetido em todas as páginas) ----
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const fy = doc.page.height - 42;
        doc.moveTo(X, fy - 8).lineTo(X + W, fy - 8).strokeColor('#9ca3af').lineWidth(0.5).stroke();
        doc.font('Times-Roman').fontSize(7).fillColor('#4b5563')
          .text(RODAPE, X, fy, { align: 'center', width: W });
      }

      doc.end();
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.GERACAO_TERMO,
      'Termo de Consentimento e Filiação gerado.',
      autor,
    );
    return pdf;
  }
}
