import { api } from './api';

/**
 * O REGISTRO DE QUEM FEZ O QUÊ.
 *
 * O log já tinha 2.903 linhas quando a tela ainda dizia "em construção" — dado
 * gravado que ninguém consulta é pior que dado nenhum, porque dá impressão de
 * controle. Ele é SÓ LEITURA: não há criar, editar nem apagar, e é assim que
 * tem de ser para servir de prova.
 */

export type AcaoAuditoria =
  | 'LOGIN' | 'LOGOUT' | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'VALIDACAO_QR' | 'EXPORT' | 'IMPORT';

export interface RegistroAuditoria {
  id: string;
  acao: AcaoAuditoria;
  entidade: string | null;
  entidadeId: string | null;
  descricao: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
  /**
   * A linha `POST /api/...` original, quando o registro foi gravado assim.
   * A API já devolve `descricao` traduzida; isto é a pista técnica, para o
   * detalhe expandido.
   */
  rotaOriginal: string | null;
  createdAt: string;
  user: { id: string; nome: string; nomeExibicao: string | null; role: string } | null;
}

/** Uma diferença de campo gravada pelo serviço. Ver `audit.diff.ts` na API. */
export interface AlteracaoDeCampo {
  campo: string;
  label: string;
  de: string | number | boolean | null | string[];
  para: string | number | boolean | null | string[];
}

/** As alterações de um registro, quando o serviço gravou o "de → para". */
export function alteracoesDoRegistro(r: RegistroAuditoria): AlteracaoDeCampo[] {
  const m = r.metadata as { alteracoes?: unknown } | null;
  if (!m || !Array.isArray(m.alteracoes)) return [];
  return (m.alteracoes as AlteracaoDeCampo[]).filter((a) => a && typeof a.campo === 'string');
}

/**
 * OS CÓDIGOS QUE APARECEM NO "DE → PARA", em português.
 *
 * O banco guarda `DESFILIADO`, `PRE_PROCESSUAL`, `EM_ANDAMENTO` — e está certo
 * que guarde: código não muda quando o rótulo muda. Mas ninguém audita lendo
 * SCREAMING_SNAKE_CASE, e a tradução é NA LEITURA, como a das frases — o que
 * está gravado continua intacto.
 *
 * O que não estiver aqui recebe o tratamento genérico (underscore vira espaço,
 * primeira maiúscula): "GANHO_EXECUCAO" vira "Ganho execucao". Feio, legível, e
 * visível o bastante para alguém acrescentar a linha certa.
 */
const ROTULO_DE_VALOR: Record<string, string> = {
  // Situação do filiado
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  DESFILIADO: 'Desfiliado',
  PENDENTE: 'Pendente',
  SUSPENSO: 'Suspenso',
  // Processo
  ENCERRADO: 'Encerrado',
  ARQUIVADO: 'Arquivado',
  IMPROCEDENTE: 'Improcedente',
  GANHO_EXECUCAO: 'Ganho, em execução',
  PRE_PROCESSUAL: 'Pré-processual',
  RASCUNHO: 'Rascunho',
  INSTITUCIONAL: 'Institucional',
  INDIVIDUAL: 'Individual',
  // Agenda e atendimento
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  AGUARDANDO: 'Aguardando',
  // Perfis
  ADMINISTRADOR: 'Administrador',
  COORDENACAO: 'Coordenação',
  ADVOGADO: 'Advogado',
  TRIAGEM: 'Triagem',
};

const SO_DATA = /^\d{4}-\d{2}-\d{2}(T|$)/;

/** Um valor do "de → para", pronto para ler. */
export function valorLegivel(v: AlteracaoDeCampo['de']): string {
  if (v === null || v === undefined || v === '') return '(vazio)';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(nenhuma)';
  if (typeof v === 'number') return String(v);

  if (SO_DATA.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      // Com hora é compromisso; sem hora é data de calendário (nascimento,
      // admissão) — mostrar "00:00" nessas só sugere uma precisão que não existe.
      const temHora = v.includes('T') && !v.startsWith(v.slice(0, 10) + 'T00:00:00.000Z');
      return d.toLocaleString('pt-BR', temHora
        ? { dateStyle: 'short', timeStyle: 'short' }
        : { dateStyle: 'short' });
    }
  }
  if (ROTULO_DE_VALOR[v]) return ROTULO_DE_VALOR[v];
  // Código desconhecido: legibiliza sem inventar tradução.
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(v)) {
    const t = v.replace(/_/g, ' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return v;
}

export interface PaginaAuditoria {
  data: RegistroAuditoria[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FiltrosAuditoria {
  acao?: string;
  userId?: string;
  entidade?: string;
  q?: string;
  de?: string;
  ate?: string;
  page?: number;
}

export const ACAO_LABEL: Record<AcaoAuditoria, string> = {
  LOGIN: 'Entrou',
  LOGOUT: 'Saiu',
  CREATE: 'Criou',
  UPDATE: 'Alterou',
  DELETE: 'Excluiu',
  VALIDACAO_QR: 'Validou QR',
  EXPORT: 'Exportou',
  IMPORT: 'Importou',
};

/**
 * A COR SEPARA O QUE IMPORTA. Exclusão é o único ato irreversível do sistema e
 * é sempre o que se procura primeiro numa auditoria; login é ruído de fundo
 * necessário. O resto fica neutro — pintar tudo é o mesmo que não pintar nada.
 */
export const ACAO_TOM: Record<AcaoAuditoria, string> = {
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  CREATE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  UPDATE: 'bg-muted text-foreground',
  LOGIN: 'bg-muted text-muted-foreground',
  LOGOUT: 'bg-muted text-muted-foreground',
  VALIDACAO_QR: 'bg-muted text-foreground',
  EXPORT: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  IMPORT: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
};

/**
 * ONDE O ATO ACONTECEU, em palavra de gente.
 *
 * `entidade` vem de dois jeitos: nome de modelo ("Processo") e rota
 * ("/api/filiados/:id/foto"). O segundo é o que fazia a coluna "Onde" ficar
 * ilegível — "processos/instancias/reavaliar" não é um lugar, é um endereço.
 *
 * A tradução cobre o MÓDULO, que é o que a pessoa procura ("mexeram em
 * filiados"), e mantém o nome do modelo quando ele já é claro. O endereço
 * completo continua no detalhe expandido.
 */
const NOME_DO_MODULO: Record<string, string> = {
  processos: 'Processos',
  compromissos: 'Agenda',
  filiados: 'Filiados',
  colaboradores: 'Colaboradores',
  atendimentos: 'Atendimentos',
  anexos: 'Anexos',
  auth: 'Acesso ao sistema',
  usuarios: 'Usuários',
  eventos: 'Eventos',
  colonia: 'Colônia de férias',
  cobrancas: 'Cobranças',
  empresas: 'Empresas',
  djen: 'Publicações (DJEN)',
  'partes-externas': 'Organizações',
  presencas: 'Presenças',
  escalas: 'Escalas',
  importacao: 'Importação',
  relatorios: 'Relatórios',
  auditoria: 'Auditoria',
};

/** "Processo" → "Processo"; "MovimentacaoProcessual" → "Movimentação". */
const NOME_DO_MODELO: Record<string, string> = {
  Processo: 'Processo',
  ParteProcesso: 'Parte do processo',
  ParteExterna: 'Organização',
  MovimentacaoProcessual: 'Andamento do processo',
  Compromisso: 'Atividade da agenda',
  Atendimento: 'Atendimento',
  Filiado: 'Filiado',
  Colaborador: 'Colaborador',
  User: 'Usuário do sistema',
  ColoniaReserva: 'Reserva da colônia',
  AnexoDocumento: 'Anexo',
};

export function rotuloDaEntidade(e: string | null): string {
  if (!e) return 'Sistema';
  if (NOME_DO_MODELO[e]) return NOME_DO_MODELO[e];
  if (!e.startsWith('/')) return e;
  const modulo = e.replace(/^\/?api\//, '').split(/[/?]/)[0];
  return NOME_DO_MODULO[modulo] ?? modulo;
}

export const opcoesAuditoria = async () =>
  (await api.get<{ usuarios: { id: string; nome: string }[]; entidades: string[]; acoes: string[] }>(
    '/auditoria/opcoes',
  )).data;

export async function listarAuditoria(f: FiltrosAuditoria): Promise<PaginaAuditoria> {
  const { data } = await api.get('/auditoria', { params: limpar(f) });
  return data;
}

export async function baixarCsvAuditoria(f: FiltrosAuditoria): Promise<void> {
  const res = await api.get('/auditoria/export.csv', {
    params: limpar(f),
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeDoArquivo(res.headers as Record<string, string>) ?? 'auditoria.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Campo vazio não vira `?acao=` na URL — o backend trataria como filtro. */
function limpar(f: FiltrosAuditoria): Record<string, string | number> {
  const saida: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') saida[k] = v as string | number;
  }
  return saida;
}

function nomeDoArquivo(headers: Record<string, string>): string | null {
  const cd = headers['content-disposition'] ?? headers['Content-Disposition'];
  const m = cd?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1]) : null;
}
