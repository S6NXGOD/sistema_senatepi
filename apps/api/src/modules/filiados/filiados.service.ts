import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria,
  MotivoDesfiliacao,
  Prisma,
  SituacaoFiliado,
  TipoDocumento,
  TipoHistoricoFiliado,
  TipoPessoa,
} from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ImageService } from '../../common/storage/image.service';
import { StorageService } from '../../common/storage/storage.service';
import { QrCodeService } from '../../common/qrcode/qrcode.service';
import { lerAsset } from '../../common/assets.util';
import { gerarMatricula, mascararCpf } from '../../common/utils/matricula.util';
import { dataCalendario } from '../../common/utils/datas.util';
import {
  calcularIdade,
  dependenteValidoParaEvento,
} from '../dependentes/dependentes.module';
import {
  montarCriacaoDependentes, montarSincronizacaoDependentes,
} from '../dependentes/dependentes.sync';
import { protegerImutaveis } from './campos-imutaveis';
import {
  ChangeSituacaoDto,
  CreateFiliadoDto,
  DesfiliarDto,
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

/** Rótulos dos motivos de desfiliação — usados no PDF, no histórico e no log. */
export const MOTIVO_DESFILIACAO_LABEL: Record<MotivoDesfiliacao, string> = {
  APOSENTADORIA: 'Aposentadoria / Saída da Categoria',
  MUDANCA_ESTADO: 'Mudança de Estado / Transferência',
  MUDANCA_PROFISSAO: 'Mudança de Profissão',
  SOLICITACAO_PESSOAL: 'Solicitação Pessoal',
  INADIMPLENCIA: 'Inadimplência',
  OUTROS: 'Outros',
};

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** 'AAAA-MM' → 'agosto/2026'. Devolve o próprio valor se vier fora do padrão. */
export function formatarMesCorte(valor: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!m) return valor;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? `${MESES_PT[mes - 1]}/${m[1]}` : valor;
}

@Injectable()
export class FiliadosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly image: ImageService,
    private readonly storage: StorageService,
    private readonly qr: QrCodeService,
    private readonly audit: AuditService,
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
    const { vinculos, dependentes, ...dados } = dto;

    const filiado = await this.prisma.filiado.create({
      data: {
        ...dados,
        cpf,
        dataNascimento: dataCalendario(dto.dataNascimento),
        dataAdmissao: dataCalendario(dto.dataAdmissao),
        // Filiação registrada AGORA. Campo próprio para o gráfico de crescimento
        // não depender de `createdAt`, que a importação legada sobrescrevia.
        dataFiliacao: new Date(),
        matricula: gerarMatricula('SEN', total + 1),
        qrToken: this.qr.gerarToken(),
        vinculos: vinculos
          ? { create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })) }
          : undefined,
        // Dependentes já na filiação: sem dependente prévio, só há criação.
        dependentes: montarCriacaoDependentes(dependentes),
      },
      include: { vinculos: true, dependentes: true },
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
        telefoneSecundario: true,
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
      // Puxa o telefone principal; se estiver vazio/nulo, cai para o secundário
      // (evita "telefone não preenchido" na alocação quando só há o secundário).
      telefone: f.telefonePrincipal || f.telefoneSecundario || null,
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

  /**
   * ATUALIZAÇÃO CADASTRAL — usada no atendimento e no autoatendimento.
   *
   * Difere de `update` num ponto: CPF, RG, nascimento e naturalidade já
   * preenchidos são protegidos. Corrigir esses dados é ato deliberado da
   * equipe, feito na tela de Editar (que chama `update` e não passa por aqui).
   */
  async atualizacaoCadastral(id: string, dto: UpdateFiliadoDto, autor?: string) {
    const atual = await this.prisma.filiado.findUnique({
      where: { id },
      select: { cpf: true, rg: true, ufRg: true, dataNascimento: true, naturalidade: true },
    });
    if (!atual) throw new NotFoundException('Filiado não encontrado');

    const { dados, ignorados } = protegerImutaveis(atual, dto as Record<string, unknown>);
    const filiado = await this.update(id, dados as UpdateFiliadoDto, autor, ignorados);
    return { ...filiado, camposProtegidos: ignorados };
  }

  async update(id: string, dto: UpdateFiliadoDto, autor?: string, protegidos: string[] = []) {
    await this.findOne(id);
    const { vinculos, dependentes, ...dados } = dto;

    const atuais = await this.prisma.dependente.findMany({
      where: { filiadoId: id },
      select: { id: true },
    });

    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        ...dados,
        cpf: dto.cpf ? dto.cpf.replace(/\D/g, '') : undefined,
        dataNascimento: dataCalendario(dto.dataNascimento),
        dataAdmissao: dataCalendario(dto.dataAdmissao),
        // Substitui os vínculos quando enviados
        vinculos: vinculos
          ? {
              deleteMany: {},
              create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })),
            }
          : undefined,
        // Mesma regra dos recadastramentos: a lista enviada vira a verdade.
        dependentes: montarSincronizacaoDependentes(dependentes, atuais),
      },
      include: { vinculos: true, dependentes: true },
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.ALTERACAO,
      'Dados cadastrais atualizados.' +
        (protegidos.length ? ` Campos protegidos ignorados: ${protegidos.join(', ')}.` : ''),
      autor,
      { campos: Object.keys(dados), protegidos },
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
  async desfiliar(id: string, dto: DesfiliarDto, autor?: string) {
    const atual = await this.findOne(id);
    if (atual.situacao === SituacaoFiliado.DESFILIADO)
      throw new BadRequestException('Este filiado já está desfiliado.');

    const observacoes = dto.observacoes?.trim() || null;
    const dataPedido = dto.dataPedido ? new Date(dto.dataPedido) : new Date();
    const mesCorte = dto.mesCorte ?? null;
    const rotulo = MOTIVO_DESFILIACAO_LABEL[dto.motivo];

    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        situacao: SituacaoFiliado.DESFILIADO,
        motivoDesfiliacao: dto.motivo,
        desfiliacaoObservacoes: observacoes,
        desfiliadoEm: dataPedido,
        desfiliadoPor: autor ?? null,
        desfiliacaoMesCorte: mesCorte,
      },
    });

    // Linha do tempo do filiado (aba Documentos/Histórico do dossiê).
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.MUDANCA_STATUS,
      `Desfiliado — ${rotulo}.` +
        (mesCorte ? ` Última mensalidade: ${formatarMesCorte(mesCorte)}.` : '') +
        (observacoes ? ` ${observacoes}` : ''),
      autor,
      { motivo: dto.motivo, mesCorte, observacoes, dataPedido: dataPedido.toISOString() },
    );

    // Auditoria global: é onde se responde "quem desfiliou, quando e por quê".
    // Nunca derruba a operação — perder o log é ruim, perder a desfiliação é pior.
    await this.audit
      .registrar({
        userId: null,
        acao: AcaoAuditoria.UPDATE,
        entidade: 'Filiado',
        entidadeId: id,
        descricao:
          `Desfiliação de ${atual.nomeCompleto} — ${rotulo}` +
          (mesCorte ? ` (corte: ${formatarMesCorte(mesCorte)})` : ''),
        metadata: {
          motivo: dto.motivo,
          motivoLabel: rotulo,
          mesCorte,
          observacoes,
          dataPedido: dataPedido.toISOString(),
          autor: autor ?? null,
        },
      })
      .catch(() => undefined);

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
    tipo?: string,
  ) {
    await this.findOne(id);
    if (!MIME_PERMITIDOS[arquivo.mimetype])
      throw new BadRequestException('Formato não permitido. Use PDF, DOC, DOCX, JPG ou PNG.');

    const ext = arquivo.originalname.split('.').pop() ?? 'bin';
    const storageKey = `filiados/${id}/documentos/${Date.now()}.${ext}`;
    await this.storage.upload(storageKey, arquivo.buffer, arquivo.mimetype);

    // Tipo válido classifica o arquivo na aba Documentos; qualquer outra coisa
    // cai no genérico, em vez de derrubar o upload por causa de um rótulo.
    const tipoDoc =
      tipo && tipo in TipoDocumento
        ? (tipo as TipoDocumento)
        : TipoDocumento.DOCUMENTO_PESSOAL;

    const documento = await this.prisma.documento.create({
      data: {
        tipo: tipoDoc,
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

  // ---- Termo de Desfiliação (PDF) ----

  /**
   * Termo de Desfiliação pronto para assinatura.
   *
   * Redesenhado para parecer o que é: um documento oficial da entidade. Ganhou
   * faixa institucional com o logotipo, blocos numerados (identificação, motivo,
   * corte financeiro, declaração) e duas assinaturas — a do filiado e a da
   * diretoria, porque o termo só se completa quando a entidade também o recebe.
   *
   * Os dados podem vir por parâmetro (o modal gera o termo ANTES de confirmar a
   * saída, para o filiado assinar) ou do próprio cadastro, quando ele já está
   * desfiliado. O parâmetro vence, para o papel refletir o que está na tela.
   */
  async gerarTermoDesfiliacaoPdf(
    id: string,
    dados?: { motivo?: string; observacoes?: string; mesCorte?: string },
    autor?: string,
  ): Promise<Buffer> {
    const f = await this.findOne(id);

    // O motivo chega como slug do enum (vindo do modal) ou já como rótulo.
    const slug = dados?.motivo?.trim();
    const motivoLabel =
      (slug && MOTIVO_DESFILIACAO_LABEL[slug as MotivoDesfiliacao]) ||
      slug ||
      (f.motivoDesfiliacao ? MOTIVO_DESFILIACAO_LABEL[f.motivoDesfiliacao] : null);
    const observacoes = dados?.observacoes?.trim() || f.desfiliacaoObservacoes || null;
    const mesCorte = dados?.mesCorte?.trim() || f.desfiliacaoMesCorte || null;

    const RODAPE =
      'DIRETORIA SENATEPI - RUA LUCÍDIO FREITAS, Nº.1070, CENTRO-NORTE, TERESINA-PI, CEP: 64000-440 | ' +
      'CONTATOS: (86) 3303-1426; (86) 99421-1117; e-mail: senatepienfermagem@outlook.com';

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const X = doc.page.margins.left;
      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const VAZIO = '_________________________________';
      const ou = (v?: string | null) => (v && String(v).trim() ? String(v) : VAZIO);

      // ---------------------------------------------------------------
      // Faixa institucional. O logotipo do acervo é BRANCO, então precisa de
      // fundo escuro — daí a faixa verde, a mesma da carteirinha e do crachá.
      // ---------------------------------------------------------------
      const ALT_FAIXA = 74;
      doc.rect(0, 0, doc.page.width, ALT_FAIXA).fill(VERDE_ESCURO);

      const logo = lerAsset('senatepi-horizontal-branco.png');
      if (logo) {
        try {
          doc.image(logo, X, 18, { fit: [150, 38] });
        } catch {
          doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text('SENATEPI', X, 26);
        }
      } else {
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text('SENATEPI', X, 26);
      }

      doc.font('Helvetica').fontSize(7.5).fillColor('#E8F5E3').text(
        'SINDICATO DOS ENFERMEIROS, AUXILIARES E TÉCNICOS\nEM ENFERMAGEM DO ESTADO DO PIAUÍ\nCNPJ: 11.378.331/0001-86',
        X + W - 230,
        20,
        { align: 'right', width: 230, lineGap: 1.5 },
      );

      // Filete de acento sob a faixa — assina visualmente o documento.
      doc.rect(0, ALT_FAIXA, doc.page.width, 4).fill(VERDE_MEDIO);

      // ---------------------------------------------------------------
      // Título
      // ---------------------------------------------------------------
      doc.y = ALT_FAIXA + 26;
      doc
        .font('Times-Bold')
        .fontSize(16)
        .fillColor('#111827')
        .text('TERMO DE DESFILIAÇÃO', X, doc.y, {
          align: 'center',
          width: W,
          characterSpacing: 0.5,
        });
      doc.moveDown(0.25);
      doc
        .font('Times-Italic')
        .fontSize(9)
        .fillColor('#4b5563')
        .text('Formalização da saída do quadro associativo', { align: 'center', width: W });
      doc.moveDown(1.2);

      /** Cabeçalho de seção: barrinha verde + rótulo, para o olho achar o bloco. */
      const secao = (titulo: string) => {
        const y = doc.y;
        doc.rect(X, y, 3, 12).fill(VERDE_MEDIO);
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(VERDE_ESCURO)
          .text(titulo.toUpperCase(), X + 9, y + 1.5, { width: W - 9, characterSpacing: 0.6 });
        doc.y = y + 20;
      };

      /** Par rótulo/valor em duas colunas — cabe mais informação em menos papel. */
      const campo = (label: string, valor: string, col: 0 | 1, linha: number, base: number) => {
        const larguraCol = (W - 16) / 2;
        const px = X + col * (larguraCol + 16);
        const py = base + linha * 30;
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#6b7280')
          .text(label.toUpperCase(), px, py, { width: larguraCol, characterSpacing: 0.4 });
        doc
          .font('Times-Roman')
          .fontSize(11)
          .fillColor('#111827')
          .text(valor, px, py + 10, { width: larguraCol, ellipsis: true });
      };

      // ---------------------------------------------------------------
      // 1. Identificação
      // ---------------------------------------------------------------
      secao('1. Identificação do(a) Filiado(a)');
      const yIdent = doc.y;
      campo('Nome completo', ou(f.nomeCompleto), 0, 0, yIdent);
      campo('CPF', ou(f.cpf ? mascararCpf(f.cpf) : null), 1, 0, yIdent);
      campo('Matrícula sindical', ou(f.matricula), 0, 1, yIdent);
      campo('COREN', ou(f.numeroCoren), 1, 1, yIdent);
      doc.y = yIdent + 64;

      // ---------------------------------------------------------------
      // 2. Motivo
      // ---------------------------------------------------------------
      secao('2. Motivo da Desfiliação');
      doc
        .font('Times-Roman')
        .fontSize(11)
        .fillColor('#111827')
        .text(motivoLabel ?? VAZIO, X, doc.y, { width: W });
      doc.moveDown(0.5);
      if (observacoes) {
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#6b7280')
          .text('OBSERVAÇÕES', X, doc.y, { characterSpacing: 0.4 });
        doc.moveDown(0.15);
        doc
          .font('Times-Roman')
          .fontSize(10)
          .fillColor('#1f2937')
          .text(observacoes, X, doc.y, { width: W, align: 'justify', lineGap: 1.5 });
      }
      doc.moveDown(1);

      // ---------------------------------------------------------------
      // 3. Corte financeiro — o bloco que a folha de pagamento procura.
      // ---------------------------------------------------------------
      secao('3. Corte Financeiro');
      const yCorte = doc.y;
      doc.roundedRect(X, yCorte, W, 40, 4).fillAndStroke('#F4FAF2', VERDE_MEDIO);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#4b5563')
        .text('ÚLTIMA MENSALIDADE A SER DESCONTADA', X + 12, yCorte + 9, { characterSpacing: 0.4 });
      doc
        .font('Times-Bold')
        .fontSize(12)
        .fillColor(VERDE_ESCURO)
        .text(
          mesCorte ? formatarMesCorte(mesCorte) : 'A definir pelo setor financeiro',
          X + 12,
          yCorte + 21,
        );
      doc.y = yCorte + 54;

      // ---------------------------------------------------------------
      // 4. Declaração
      // ---------------------------------------------------------------
      secao('4. Declaração');
      doc
        .font('Times-Roman')
        .fontSize(10.5)
        .fillColor('#1f2937')
        .text(
          'Pelo presente instrumento, o(a) filiado(a) acima identificado(a) formaliza a sua DESFILIAÇÃO ' +
            'do quadro associativo do SENATEPI, deixando de contribuir e de usufruir dos benefícios e da ' +
            'representação sindical a partir desta data, nos termos do estatuto da entidade. Declara estar ' +
            'ciente de que o presente pedido não o exime de eventuais débitos anteriores ao mês de corte ' +
            'acima indicado.',
          X,
          doc.y,
          { align: 'justify', width: W, lineGap: 2.5 },
        );
      doc.moveDown(1.6);

      const dataFmt = new Date().toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      doc
        .font('Times-Roman')
        .fontSize(10.5)
        .fillColor('#1f2937')
        .text(`Teresina/PI, ${dataFmt}.`, X, doc.y, { width: W });

      // ---------------------------------------------------------------
      // Assinaturas — duas: quem sai e quem recebe.
      // ---------------------------------------------------------------
      doc.moveDown(3.2);
      const yAss = doc.y;
      const larguraAss = (W - 40) / 2;
      const assinatura = (rotulo: string, sub: string, col: 0 | 1) => {
        const px = X + col * (larguraAss + 40);
        doc
          .moveTo(px, yAss)
          .lineTo(px + larguraAss, yAss)
          .strokeColor('#374151')
          .lineWidth(0.8)
          .stroke();
        doc
          .font('Times-Bold')
          .fontSize(9.5)
          .fillColor('#111827')
          .text(rotulo, px, yAss + 6, { align: 'center', width: larguraAss });
        doc
          .font('Times-Roman')
          .fontSize(8)
          .fillColor('#6b7280')
          .text(sub, px, yAss + 19, { align: 'center', width: larguraAss });
      };
      assinatura('Assinatura do(a) Filiado(a)', ou(f.nomeCompleto), 0);
      assinatura('Diretoria / Secretaria', 'SENATEPI', 1);

      // ---- Rodapé fixo (repetido em todas as páginas) ----
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const fy = doc.page.height - 42;
        doc
          .moveTo(X, fy - 8)
          .lineTo(X + W, fy - 8)
          .strokeColor(VERDE_MEDIO)
          .lineWidth(0.8)
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(6.5)
          .fillColor('#4b5563')
          .text(RODAPE, X, fy, { align: 'center', width: W });
      }
      doc.end();
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.GERACAO_TERMO,
      'Termo de Desfiliação gerado.',
      autor,
    );
    return pdf;
  }
}
