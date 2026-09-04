import { AREAS_JURIDICAS } from '../processos/areas.catalogo';
import { NpuUtils } from '../processos/utils/npu.util';

/**
 * LEITURA E CONFERÊNCIA DA PLANILHA DE PROCESSOS.
 *
 * PURO DE PROPÓSITO — nada de banco, nada de rede. A conferência de uma
 * planilha de 82 linhas tem dezenas de regras pequenas ("o NPU tem dígito
 * verificador válido?", "esta categoria existe?", "o polo ativo é coerente com
 * o que foi preenchido?"), e cada uma delas precisa de teste próprio. Prender
 * isso num serviço com Prisma injetado obrigaria a subir meio módulo para
 * testar uma regra de duas linhas.
 *
 * O QUE ESTE ARQUIVO **NÃO** CONFERE, e é deliberado: se o advogado existe, se
 * o filiado existe, se o processo já está cadastrado, se a parte contrária já
 * tem registro. Tudo isso é pergunta ao banco, e mistura-la aqui tornaria o
 * util impuro sem ganhar nada — o serviço faz essa camada depois, e as duas
 * listas de problema se juntam na mesma linha da prévia.
 */

/** Cabeçalhos que a planilha precisa ter. O resto é opcional. */
export const COLUNAS_OBRIGATORIAS = ['npu', 'polo_ativo'] as const;

/** Todos os cabeçalhos que o importador entende. */
export const COLUNAS_CONHECIDAS = [
  'npu',
  'polo_ativo',
  'polo_ativo_nome',
  'filiado_nome',
  'filiado_cpf',
  'reu_nome',
  'reu_cnpj',
  'reu_ja_cadastrado',
  'advogado_email',
  'equipe_emails',
  'categoria',
  'etiqueta',
  'andamento',
  'andamento_data',
  'conferir',
] as const;

export type PoloAtivoCsv = 'INSTITUCIONAL' | 'FILIADOS' | 'OUTRA';
const POLOS: PoloAtivoCsv[] = ['INSTITUCIONAL', 'FILIADOS', 'OUTRA'];

/** Um réu da linha — a planilha aceita vários, separados por `|`. */
export interface ReuCsv {
  nome: string;
  /** Só dígitos; vazio quando a planilha não trouxe. */
  cnpj: string;
}

export interface LinhaProcesso {
  /** Número da linha no arquivo, contando o cabeçalho como 1. */
  linha: number;
  npu: string;
  poloAtivo: PoloAtivoCsv;
  poloAtivoNome: string;
  filiadoNome: string;
  filiadoCpf: string;
  reus: ReuCsv[];
  advogadoEmail: string;
  equipeEmails: string[];
  categoria: string;
  etiquetas: string[];
  andamento: string;
  /** ISO (só a data) ou vazio. */
  andamentoData: string;
  /** Impedem a importação da linha. */
  erros: string[];
  /** Não impedem — a linha entra, com a informação incompleta. */
  avisos: string[];
}

const so = (v: unknown) => String(v ?? '').trim();
const digitos = (v: string) => v.replace(/\D/g, '');
const CATEGORIAS = new Set(AREAS_JURIDICAS.map((a) => a.slug));

/**
 * Normaliza o cabeçalho para casar com o que a planilha traz de verdade.
 * "NPU", " npu ", "Npu" e "N.P.U" são a mesma coluna — e obrigar a equipe a
 * acertar maiúscula e acento num arquivo que passou por Excel é implicância.
 */
export function normalizarCabecalho(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * A data que a equipe digitou vira ISO, ou vazio.
 *
 * Aceita `AAAA-MM-DD`, `DD/MM/AAAA` e `AAAA-MM` (mês inteiro vira o dia 1º) —
 * é o que sai de um Excel brasileiro e do que uma pessoa digita à mão. Data
 * inválida NÃO é erro bloqueante: a linha entra sem data, com aviso, porque a
 * data do andamento é conveniência e não pode impedir o processo de existir.
 */
export function lerData(bruto: string): string | null {
  const v = so(bruto);
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-01`;
  return null;
}

/** Os réus da linha: `NOME` ou `NOME A|NOME B`, com CNPJs na mesma ordem. */
export function lerReus(nomes: string, cnpjs: string): ReuCsv[] {
  const ns = so(nomes).split('|').map(so).filter(Boolean);
  const cs = so(cnpjs).split('|').map((c) => digitos(so(c)));
  return ns.map((nome, i) => ({ nome, cnpj: cs[i] ?? '' }));
}

/**
 * Confere UMA linha. Devolve sempre um objeto — nunca lança.
 *
 * Erro impede a linha; aviso deixa passar. A distinção é a coisa mais
 * importante deste arquivo: uma planilha de 82 linhas em que qualquer
 * imperfeição vira erro é uma planilha que nunca é importada. Só entra em
 * `erros` o que tornaria o registro ERRADO — não o que o torna incompleto.
 */
export function conferirLinha(bruta: Record<string, string>, linha: number): LinhaProcesso {
  const erros: string[] = [];
  const avisos: string[] = [];
  const g = (col: string) => so(bruta[col]);

  // ---- NPU ---------------------------------------------------------------
  const npuBruto = g('npu');
  const npu = digitos(npuBruto);
  if (!npuBruto) {
    erros.push('Sem número do processo (NPU).');
  } else if (npu.length !== 20) {
    erros.push(`NPU deve ter 20 dígitos — veio com ${npu.length}.`);
  } else if (!NpuUtils.dvValido(npu)) {
    // Dígito verificador: pega o erro de digitação AQUI, e não quarenta
    // minutos depois, quando o CNJ responderia "não encontrado" e ninguém
    // saberia se o processo não existe ou se a célula está errada.
    erros.push('NPU com 20 dígitos, mas o dígito verificador não confere — confira a digitação.');
  } else if (!NpuUtils.siglaTribunal(npu)) {
    // Sem tribunal não há índice para consultar — e a mensagem diz por quê.
    erros.push('Não foi possível deduzir o tribunal a partir do NPU.');
  }

  // ---- Polo ativo --------------------------------------------------------
  const poloBruto = g('polo_ativo').toUpperCase();
  const poloAtivo = (POLOS.includes(poloBruto as PoloAtivoCsv) ? poloBruto : '') as PoloAtivoCsv;
  if (!poloBruto) {
    erros.push('Sem polo ativo — informe INSTITUCIONAL, FILIADOS ou OUTRA.');
  } else if (!poloAtivo) {
    erros.push(`Polo ativo "${poloBruto}" não existe — use INSTITUCIONAL, FILIADOS ou OUTRA.`);
  }

  const poloAtivoNome = g('polo_ativo_nome');
  const filiadoNome = g('filiado_nome');
  const filiadoCpf = digitos(g('filiado_cpf'));

  /**
   * COERÊNCIA DO POLO. Este é o par de regras que evita o pior erro possível
   * de uma importação de processos: o polo invertido. Na planilha original,
   * DOIS processos têm o sindicato como RÉU (ação rescisória do SINSEP,
   * dissídio do SINDHOSPI) — se entrassem como institucionais, o sistema diria
   * que o SENATEPI processou quem na verdade o processou.
   */
  if (poloAtivo === 'OUTRA' && !poloAtivoNome) {
    erros.push('Polo ativo OUTRA exige o nome de quem move a ação (polo_ativo_nome).');
  }
  if (poloAtivo === 'INSTITUCIONAL' && poloAtivoNome) {
    avisos.push('Polo INSTITUCIONAL ignora polo_ativo_nome — o autor é o próprio sindicato.');
  }
  if (poloAtivo === 'FILIADOS' && !filiadoCpf) {
    // NÃO é erro: a orientação é entrar sem vínculo quando o CPF não veio.
    avisos.push(
      filiadoNome
        ? `Sem CPF de "${filiadoNome}" — o processo entra SEM filiado vinculado.`
        : 'Polo FILIADOS sem CPF — o processo entra SEM filiado vinculado.',
    );
  }
  if (filiadoCpf && filiadoCpf.length !== 11) {
    avisos.push(`CPF com ${filiadoCpf.length} dígitos — ignorado, o processo entra sem filiado.`);
  }

  // ---- Réus --------------------------------------------------------------
  const reus = lerReus(g('reu_nome'), g('reu_cnpj'));
  if (!reus.length) {
    // O CNJ nunca devolve partes; sem isto o processo nasce sem saber contra
    // quem litiga, que é o defeito que a lista já sinaliza com "sem réu".
    avisos.push('Sem parte contrária — o processo entra e fica marcado como "sem réu cadastrado".');
  }
  for (const r of reus) {
    if (r.cnpj && r.cnpj.length !== 14 && r.cnpj.length !== 11) {
      avisos.push(`CNPJ de "${r.nome}" com ${r.cnpj.length} dígitos — será ignorado.`);
    }
    if (!r.cnpj) {
      avisos.push(`"${r.nome}" sem CNPJ — cadastrado pelo nome da planilha, confira a razão social.`);
    }
  }

  // ---- Categoria / etiquetas --------------------------------------------
  const categoria = g('categoria').toUpperCase();
  if (categoria && !CATEGORIAS.has(categoria)) {
    avisos.push(`Área "${categoria}" não existe — o processo entra sem área jurídica.`);
  }
  const etiquetas = g('etiqueta').split('|').map(so).filter(Boolean);

  // ---- Advogados ---------------------------------------------------------
  const advogadoEmail = g('advogado_email').toLowerCase();
  const equipeEmails = g('equipe_emails')
    .split('|')
    .map((e) => so(e).toLowerCase())
    .filter(Boolean);
  if (!advogadoEmail) {
    // Sem responsável o processo não aparece na carteira de ninguém e o robô
    // de prazos não sabe a quem atribuir tarefa. Aviso, não erro: é corrigível
    // depois na ficha, e barrar a importação inteira por isso seria pior.
    avisos.push('Sem advogado responsável — ninguém vai ver este processo na própria carteira.');
  }

  // ---- Andamento ---------------------------------------------------------
  const andamento = g('andamento');
  const dataBruta = g('andamento_data');
  const andamentoData = lerData(dataBruta);
  if (dataBruta && !andamentoData) {
    avisos.push(`Data "${dataBruta}" não reconhecida — a nota entra com a data de hoje.`);
  }
  if (andamento && !andamentoData) {
    /**
     * A NOTA SEM DATA NÃO PODE VALER POR HOJE.
     *
     * A ordenação padrão da lista é pelo andamento mais recente, e o gatilho da
     * coluna `ultimo_movimento_em` usa `COALESCE(data_fato, created_at)`. Sem
     * data, oitenta e duas notas gravadas na mesma tarde carimbariam o acervo
     * inteiro com a data de hoje e jogariam tudo para o topo ao mesmo tempo —
     * que é o mesmo que não ter ordenação nenhuma.
     *
     * O texto do andamento é um RESUMO DE SITUAÇÃO ("Sentença de procedência.
     * Aguarda R.O."), não um evento datado. Por isso, sem data na planilha, a
     * importação ancora a nota no último fato já conhecido do processo — ver
     * `registrarAndamento`. A ordenação não se mexe, e nenhuma data é inventada.
     */
    avisos.push(
      'Andamento sem data: a nota será ancorada no último andamento conhecido do processo, ' +
        'para não alterar a ordem da lista.',
    );
  }

  return {
    linha,
    npu,
    poloAtivo,
    poloAtivoNome,
    filiadoNome,
    filiadoCpf: filiadoCpf.length === 11 ? filiadoCpf : '',
    reus,
    advogadoEmail,
    equipeEmails,
    categoria: CATEGORIAS.has(categoria) ? categoria : '',
    etiquetas,
    andamento,
    andamentoData: andamentoData ?? '',
    erros,
    avisos,
  };
}

/**
 * Confere a planilha inteira.
 *
 * A DUPLICATA DENTRO DO ARQUIVO é conferida aqui, e não no banco: dois NPUs
 * iguais na mesma planilha fariam a segunda importação bater no 409 do
 * endpoint e virar "erro" — quando o problema real está no arquivo, e a
 * mensagem tem de dizer isso.
 */
export function conferirPlanilha(
  cabecalhos: string[],
  linhas: Record<string, string>[],
): { linhas: LinhaProcesso[]; problemasNoArquivo: string[] } {
  const problemasNoArquivo: string[] = [];

  const mapa = new Map<string, string>();
  for (const c of cabecalhos) mapa.set(normalizarCabecalho(c), c);
  for (const obrigatoria of COLUNAS_OBRIGATORIAS) {
    if (!mapa.has(obrigatoria)) problemasNoArquivo.push(`Falta a coluna "${obrigatoria}".`);
  }
  const desconhecidas = [...mapa.keys()].filter(
    (k) => !(COLUNAS_CONHECIDAS as readonly string[]).includes(k),
  );
  if (desconhecidas.length) {
    problemasNoArquivo.push(`Colunas ignoradas: ${desconhecidas.join(', ')}.`);
  }

  const conferidas = linhas.map((bruta, i) => {
    // Reescreve a linha com os cabeçalhos normalizados, para `conferirLinha`
    // não precisar saber como o Excel escreveu cada título.
    const normalizada: Record<string, string> = {};
    for (const [norm, original] of mapa) normalizada[norm] = bruta[original] ?? '';
    return conferirLinha(normalizada, i + 2); // +2: cabeçalho é a linha 1
  });

  const vistos = new Map<string, number>();
  for (const l of conferidas) {
    if (!l.npu) continue;
    const antes = vistos.get(l.npu);
    if (antes) l.erros.push(`NPU repetido — já aparece na linha ${antes} deste arquivo.`);
    else vistos.set(l.npu, l.linha);
  }

  return { linhas: conferidas, problemasNoArquivo };
}

// ===========================================================================
// Segunda passada: o que ainda falta num processo que JÁ está cadastrado
// ===========================================================================

/** O que a planilha ainda tem a acrescentar a um processo já cadastrado. */
export type Pendencia = 'CATEGORIA' | 'ETIQUETAS' | 'ANDAMENTO';

/** Retrato do processo como ele está hoje no banco. */
export interface EstadoNoBanco {
  categoria: string | null;
  etiquetas: string[];
  /** Descrições das notas internas já gravadas — para não repetir o andamento. */
  andamentos: string[];
}

export const PENDENCIA_LABEL: Record<Pendencia, string> = {
  CATEGORIA: 'área jurídica',
  ETIQUETAS: 'etiquetas',
  ANDAMENTO: 'andamento do jurídico',
};

/**
 * O QUE A PRÉVIA PROMETE É O QUE A EXECUÇÃO FAZ.
 *
 * Esta função é a única que decide se um processo já cadastrado ainda tem o que
 * receber — e é chamada nos DOIS lugares: na conferência, para a tela dizer
 * quantas linhas serão completadas, e na importação, para completar de fato.
 *
 * Duas cópias divergiriam na primeira correção, e o sintoma seria o pior
 * possível: a tela prometendo "80 a completar" e o resultado dizendo "80
 * ignorados", sem ninguém conseguir dizer qual das duas mentiu.
 *
 * NUNCA SOBRESCREVE. Só entra o campo que está VAZIO no banco: a planilha é
 * uma fonte auxiliar, e quem digitou uma categoria na ficha depois da primeira
 * carga não pode perdê-la porque alguém subiu o arquivo de novo.
 */
export function oQueCompletar(atual: EstadoNoBanco, l: LinhaProcesso): Pendencia[] {
  const faltas: Pendencia[] = [];
  if (!atual.categoria && l.categoria) faltas.push('CATEGORIA');
  if (l.etiquetas.some((e) => !atual.etiquetas.includes(e))) faltas.push('ETIQUETAS');
  if (l.andamento && !atual.andamentos.includes(l.andamento)) faltas.push('ANDAMENTO');
  return faltas;
}

/** Frase para a linha da prévia — o que ESTA linha vai ganhar, em português. */
export function avisoDeCompletar(faltas: Pendencia[]): string {
  if (!faltas.length) return 'Já cadastrado e completo — nada a fazer nesta linha.';
  const lista = faltas.map((f) => PENDENCIA_LABEL[f]);
  const texto =
    lista.length === 1
      ? lista[0]
      : `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`;
  return `Já cadastrado — será completado: ${texto}.`;
}

/**
 * O MODELO DA PLANILHA — gerado a partir das mesmas constantes que o
 * importador usa para conferir.
 *
 * Um arquivo de exemplo guardado em `public/` seria uma segunda verdade: no dia
 * em que uma coluna mudasse, o modelo continuaria oferecendo a antiga e a
 * pessoa levaria "Falta a coluna X" depois de preencher oitenta linhas. Aqui o
 * cabeçalho é `COLUNAS_CONHECIDAS` — se a lista mudar, o modelo muda junto.
 *
 * Vai com DUAS linhas de exemplo, uma institucional e uma de filiado, porque a
 * coluna `polo_ativo` muda o significado das outras e um exemplo só não mostra
 * isso. E com BOM: o Excel em português abre CSV sem BOM com os acentos
 * quebrados, e a primeira impressão do arquivo seria de que o sistema erra.
 */
const EXEMPLOS: Record<(typeof COLUNAS_CONHECIDAS)[number], string>[] = [
  {
    npu: '0000123-45.2026.5.22.0001',
    polo_ativo: 'INSTITUCIONAL',
    polo_ativo_nome: '',
    filiado_nome: '',
    filiado_cpf: '',
    reu_nome: 'HOSPITAL EXEMPLO LTDA',
    reu_cnpj: '12.345.678/0001-90',
    reu_ja_cadastrado: '',
    advogado_email: 'advogado@sindicato.org.br',
    equipe_emails: 'colega@sindicato.org.br',
    categoria: 'SINDICAL_COLETIVO',
    etiqueta: 'piso salarial',
    andamento: 'Ação ajuizada em defesa da categoria.',
    andamento_data: '2026-02-10',
    conferir: '',
  },
  {
    npu: '0000987-65.2026.5.22.0002',
    polo_ativo: 'FILIADOS',
    polo_ativo_nome: '',
    filiado_nome: 'MARIA DA SILVA',
    filiado_cpf: '000.000.000-00',
    reu_nome: 'CLINICA EXEMPLO S/A',
    reu_cnpj: '',
    reu_ja_cadastrado: '',
    advogado_email: 'advogado@sindicato.org.br',
    equipe_emails: '',
    categoria: 'TRABALHISTA',
    etiqueta: '',
    andamento: 'Reclamação trabalhista individual.',
    andamento_data: '',
    conferir: 'sim',
  },
];

/**
 * CSV do modelo, pronto para download.
 *
 * Separador PONTO E VÍRGULA e BOM no início: é o que o Excel em português
 * espera. Sem o BOM ele abre o arquivo com os acentos quebrados, e a primeira
 * impressão do sistema seria a de que ele erra o próprio modelo.
 */
export function modeloDePlanilha(): string {
  const CRLF = String.fromCharCode(13, 10);
  const BOM = String.fromCharCode(0xfeff);
  const linhas = [
    COLUNAS_CONHECIDAS.join(';'),
    ...EXEMPLOS.map((e) => COLUNAS_CONHECIDAS.map((c) => e[c] ?? '').join(';')),
  ];
  return BOM + linhas.join(CRLF) + CRLF;
}
