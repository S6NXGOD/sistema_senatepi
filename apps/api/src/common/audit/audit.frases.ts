/**
 * O QUE CADA ROTA DE ESCRITA SIGNIFICA, em português.
 *
 * Usada em dois momentos, e a repartição é de propósito:
 *
 *  1. AO GRAVAR (`AuditInterceptor`), quando nenhum serviço escreveu a frase
 *     dele — assim o registro nasce legível.
 *  2. AO LER (`AuditoriaService`), para os 1.555 registros que a produção já
 *     tem gravados como `POST /api/processos/instancias/reavaliar?limite=10`.
 *
 * POR QUE TRADUZIR NA LEITURA EM VEZ DE CORRIGIR O BANCO: registro de auditoria
 * não se reescreve. Um log que a própria aplicação edita — mesmo "só para
 * melhorar o texto" — deixa de servir como prova, e é o único motivo de ele
 * existir. O que está gravado fica; o que muda é como se mostra.
 */

/** O verbo, em português, para a rota que não está na tabela. */
export const VERBO_HTTP: Record<string, string> = {
  POST: 'Criou',
  PUT: 'Alterou',
  PATCH: 'Alterou',
  DELETE: 'Excluiu',
};

/**
 * ROTAS QUE NÃO SÃO ATO DE NINGUÉM.
 *
 * `auth/refresh` é o navegador renovando o token sozinho, a cada tantos
 * minutos, sem ninguém clicar em nada — 40 registros na produção dizendo que a
 * sessão continuou existindo. Auditoria responde "quem fez o quê"; isto não tem
 * quem nem o quê, e só empurra para baixo o que tem.
 *
 * O LOGIN CONTINUA REGISTRADO, e é ele que interessa: "quem entrou no sistema
 * no domingo" é uma das três perguntas que trazem alguém a esta tela.
 */
export const NAO_AUDITAR: RegExp[] = [
  /\/auth\/refresh/,
];

/** Esta requisição merece registro? */
export function valeAuditar(caminho: string): boolean {
  return !NAO_AUDITAR.some((r) => r.test(caminho));
}

export const O_QUE_A_ROTA_FAZ: { padrao: RegExp; frase: string }[] = [
  { padrao: /\/processos\/instancias\/reavaliar/, frase: 'Reavaliou as instâncias dos processos' },
  { padrao: /\/processos\/partes\/vinculos-pendentes/, frase: 'Resolveu vínculos de filiado em lote' },
  { padrao: /\/processos\/[^/]+\/sincronizar/, frase: 'Sincronizou um processo com o DataJud' },
  { padrao: /\/processos\/[^/]+\/formalizar/, frase: 'Ajuizou um caso pré-processual' },
  { padrao: /\/processos\/[^/]+\/advogados/, frase: 'Mudou a equipe de um processo' },
  { padrao: /\/processos\/importar/, frase: 'Importou um processo do DataJud' },
  { padrao: /\/processos\/[^/]+\/partes/, frase: 'Mexeu nas partes de um processo' },
  { padrao: /\/processos\/partes\/[^/]+\/filiado/, frase: 'Identificou uma parte como filiado' },
  { padrao: /\/compromissos\/[^/]+\/status/, frase: 'Mudou o andamento de uma atividade' },
  { padrao: /\/compromissos\/[^/]+\/concluir/, frase: 'Concluiu uma atividade' },
  { padrao: /\/compromissos\/[^/]+\/cancelar/, frase: 'Cancelou uma atividade' },
  { padrao: /\/compromissos\/[^/]+\/remarcar/, frase: 'Remarcou uma atividade' },
  { padrao: /\/compromissos/, frase: 'Mexeu numa atividade da agenda' },
  { padrao: /\/filiados\/[^/]+\/recadastramento/, frase: 'Recadastrou um filiado' },
  { padrao: /\/filiados\/[^/]+\/foto/, frase: 'Trocou a foto de um filiado' },
  { padrao: /\/filiados\/[^/]+\/desfiliar/, frase: 'Desfiliou alguém' },
  { padrao: /\/filiados/, frase: 'Mexeu no cadastro de um filiado' },
  { padrao: /\/djen\/processo\/[^/]+\/sincronizar/, frase: 'Buscou publicações no DJEN' },
  { padrao: /\/anexos/, frase: 'Mexeu em um anexo' },
  { padrao: /\/atendimentos/, frase: 'Mexeu num atendimento' },
  { padrao: /\/partes-externas\/[^/]+\/nao-duplicada/, frase: 'Marcou duas organizações como distintas' },
  { padrao: /\/partes-externas\/[^/]+\/mesclar/, frase: 'Mesclou organizações duplicadas' },
  { padrao: /\/partes-externas/, frase: 'Mexeu no cadastro de uma organização' },
  { padrao: /\/importacoes\/[^/]+\/upload/, frase: 'Subiu uma planilha para importação' },
  { padrao: /\/importacoes/, frase: 'Mexeu numa importação em lote' },
  { padrao: /\/escalas/, frase: 'Mexeu na escala dos advogados' },
  { padrao: /\/empresas/, frase: 'Mexeu numa empresa contribuinte' },
  { padrao: /\/profile\/change-password/, frase: 'Trocou a própria senha' },
  { padrao: /\/profile\/avatar/, frase: 'Trocou a própria foto' },
  { padrao: /\/profile/, frase: 'Alterou o próprio perfil' },
  { padrao: /\/cadastros\/departamentos/, frase: 'Mexeu nos departamentos' },
  { padrao: /\/cadastros\/cargos/, frase: 'Mexeu nos cargos' },
  { padrao: /\/cadastros/, frase: 'Mexeu numa tabela de apoio' },
  { padrao: /\/tipos-evento/, frase: 'Mexeu nos tipos de atividade' },
  { padrao: /\/auth\/login/, frase: 'Entrou no sistema' },
  { padrao: /\/auth\/logout/, frase: 'Saiu do sistema' },
  { padrao: /\/usuarios/, frase: 'Mexeu num usuário do sistema' },
  { padrao: /\/eventos/, frase: 'Mexeu num evento' },
  { padrao: /\/colonia/, frase: 'Mexeu numa reserva da colônia' },
  { padrao: /\/cobrancas/, frase: 'Mexeu numa cobrança' },
];

/** "/api/compromissos/:id/status" → "compromissos" */
export function moduloDaRota(caminho: string): string {
  return caminho.replace(/^\/?api\//, '').split(/[/?]/)[0] || 'sistema';
}

/** A frase de uma rota, quando ela é tudo que se tem. */
export function fraseDaRota(metodo: string, caminho: string): string {
  const conhecida = O_QUE_A_ROTA_FAZ.find((r) => r.padrao.test(caminho));
  if (conhecida) return conhecida.frase;
  return `${VERBO_HTTP[metodo] ?? 'Alterou'} em ${moduloDaRota(caminho)}`;
}

/** `POST /api/x` → `{ metodo, caminho }`; qualquer outra coisa → nulo. */
export function lerLinhaHttp(descricao?: string | null): { metodo: string; caminho: string } | null {
  const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)/.exec(descricao ?? '');
  return m ? { metodo: m[1], caminho: m[2] } : null;
}

/**
 * A descrição legível de um registro já gravado.
 *
 * Devolve a original quando ela já é uma frase — a esmagadora maioria dos
 * registros escritos à mão diz exatamente o que aconteceu, com nome e tudo
 * ("SARA MACHADO MIRANDA identificada como o filiado …"), e mexer nelas só
 * pioraria.
 */
export function descricaoLegivel(descricao?: string | null): string | null {
  const linha = lerLinhaHttp(descricao);
  if (!linha) return descricao ?? null;
  return fraseDaRota(linha.metodo, linha.caminho);
}
