/**
 * FOLHA DA PREFEITURA — leitura, normalização e JULGAMENTO de cada linha.
 *
 * Tudo aqui é função PURA, sem banco e sem Nest, porque é aqui que mora a
 * decisão que não pode errar: **quem é esta pessoa?**
 *
 * O PROBLEMA CENTRAL: a planilha da Prefeitura não traz CPF. Traz Órgão,
 * Matrícula, Nome, Quadro, Lotação, Cargo e Valor. Sem CPF, a identidade sai da
 * MATRÍCULA, que na Prefeitura de Teresina é única no município inteiro —
 * confirmado pelo sindicato, e é também a matrícula que o filiado sabe de cor.
 *
 * AS DUAS REGRAS QUE GOVERNAM ESTE ARQUIVO:
 *
 *  1. A matrícula identifica a PESSOA, não o posto. Se ela aparece em outra
 *     secretaria, é a mesma pessoa transferida — atualiza-se o vínculo. Tratar
 *     transferência como conflito jogaria centenas de servidores numa fila de
 *     decisão manual sem que houvesse dúvida alguma a resolver.
 *  2. Nome NUNCA casa sozinho. "MARIA DA SILVA" se repete muito numa folha de
 *     4.000 pessoas. Casar por nome fundiria pessoas reais distintas, e a fusão
 *     é irreversível na prática: o segundo cadastro deixa de nascer e ninguém
 *     descobre que faltou.
 *
 * O nome não é inútil, porém: ele CONTRADIZ. Quando a matrícula bate e o nome é
 * de outra pessoa, alguma coisa está errada na origem (matrícula reaproveitada,
 * digitação) e a linha vai para decisão humana em vez de sobrescrever a ficha.
 *
 * DOIS ARQUIVOS, UM PERFIL. O mesmo código lê a folha mensal da Prefeitura
 * (Órgão, Matrícula, Nome, Quadro, Lotação, Cargo, Valor) e o export do banco
 * legado do SINDSERM (`name`, `registration`, `position`, `cpf`, contato,
 * datas, `possui_desconto`). São layouts diferentes com a MESMA regra de
 * identidade — e é justamente por compartilharem a matrícula como âncora que a
 * folha do mês seguinte reencontra quem entrou pela carga inicial. Um perfil
 * separado para o legado teria duas regras de identidade que precisariam
 * concordar para sempre.
 */

// As regras de CPF, e-mail e data são as MESMAS do importador legado — vêm de
// lá em vez de serem reescritas aqui. Duas validações de CPF no mesmo módulo
// divergiriam na primeira correção feita só de um lado.
import {
  cpfValido,
  cpfVazioOuPlaceholder,
  emailValido,
  limparCpf,
  parseData,
} from './mapeamento.util';

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/** Sem acento, MAIÚSCULAS, espaços colapsados e aparados. */
export function normalizarTexto(valor?: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matrícula comparável.
 *
 * Sem espaço algum e SEM ZEROS À ESQUERDA: a mesma folha alterna "0012345" e
 * "12345" conforme a coluna tenha sido exportada como texto ou como número — o
 * Excel come o zero sozinho. Tratar os dois como matrículas diferentes criaria
 * um cadastro novo a cada reexportação da planilha.
 *
 * O último caractere é preservado mesmo sendo zero (`'000'` → `'0'`), para que
 * uma matrícula degenerada não vire string vazia e pareça ausente.
 */
export function normalizarMatricula(valor?: string | null): string {
  const bruto = (valor ?? '').toUpperCase().replace(/\s/g, '').trim();
  if (!bruto) return '';
  return bruto.replace(/^0+(?=.)/, '');
}

/**
 * VALOR → a folha evidencia desconto para esta pessoa?
 *
 * O valor em si é DESCARTADO: não é gravado, não é exibido, não entra no
 * cadastro. O que se aproveita é um único bit — "há desconto acontecendo?" —
 * porque é dele que depende a carteirinha: enquanto o desconto em folha não é
 * identificado, a carteirinha fica pendente.
 *
 * Sem ler esta coluna, todo mundo da planilha entraria marcado como "desconta
 * em folha", inclusive quem está listado com zero, e o sindicato emitiria
 * carteirinha válida para quem não contribui. Jogar a coluna fora por completo
 * custaria exatamente essa informação.
 *
 * Aceita o formato brasileiro ("1.234,56") e o americano ("1234.56"), porque a
 * mesma planilha alterna os dois conforme quem exportou. Coluna ausente devolve
 * `null` = "a folha não disse" — diferente de "disse que é zero".
 */
export function descontoNaFolha(valor?: string | null): boolean | null {
  const bruto = (valor ?? '').trim();
  if (!bruto) return null;

  // Tira moeda e espaços; mantém dígitos, vírgula, ponto e o sinal.
  const limpo = bruto.replace(/[^\d,.-]/g, '');
  if (!limpo || !/\d/.test(limpo)) return null;

  // Se tem vírgula, ela é o separador decimal e o ponto é milhar (pt-BR).
  const numerico = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  const n = Number(numerico);
  if (Number.isNaN(n)) return null;
  return n > 0;
}

/**
 * Preposições — não identificam ninguém e aparecem/somem conforme quem digitou.
 * "MARIA DE SOUZA" e "MARIA SOUZA" são a mesma pessoa para efeito de comparação.
 */
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'D']);

/** Palavras que de fato identificam a pessoa, em ordem. */
export function tokensNome(nome?: string | null): string[] {
  return normalizarTexto(nome)
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(' ')
    .filter((p) => p.length > 0 && !PARTICULAS.has(p));
}

export type SemelhancaNome = 'IGUAL' | 'COMPATIVEL' | 'DIFERENTE';

/**
 * O quanto dois nomes de PESSOA combinam.
 *
 *  IGUAL       mesmas palavras significativas, mesma ordem.
 *  COMPATIVEL  primeiro e último nome batem, e nenhuma palavra do meio se
 *              contradiz — cobre "MARIA S. DA COSTA" × "MARIA SILVA DA COSTA"
 *              e a abreviação do meio, que é o padrão em folha de pagamento.
 *  DIFERENTE   qualquer outra coisa.
 *
 * COMPATIVEL NÃO É "É A MESMA PESSOA". É só "não contradiz" — o suficiente para
 * aceitar uma atualização quando a matrícula JÁ bateu, e insuficiente para
 * casar alguém por conta própria. Essa distinção é o que separa este código de
 * um merge por nome.
 */
export function compararNomes(a?: string | null, b?: string | null): SemelhancaNome {
  const ta = tokensNome(a);
  const tb = tokensNome(b);
  if (ta.length === 0 || tb.length === 0) return 'DIFERENTE';
  if (ta.join(' ') === tb.join(' ')) return 'IGUAL';

  // Primeiro e último precisam bater — são os que quase nunca são abreviados.
  const primeiroIgual = ta[0] === tb[0];
  const ultimoIgual = ta[ta.length - 1] === tb[tb.length - 1];
  if (!primeiroIgual || !ultimoIgual) return 'DIFERENTE';
  if (ta.length === 1 || tb.length === 1) return 'DIFERENTE'; // só o primeiro nome não basta

  // Nomes do meio: uma inicial casa com a palavra que começa por ela.
  const meioA = ta.slice(1, -1);
  const meioB = tb.slice(1, -1);
  const combina = (x: string, y: string) =>
    x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y));

  const [curto, longo] = meioA.length <= meioB.length ? [meioA, meioB] : [meioB, meioA];
  let i = 0;
  for (const palavra of longo) {
    if (i < curto.length && combina(curto[i], palavra)) i++;
  }
  // Todas as palavras do lado mais curto encontraram par, na ordem.
  return i === curto.length ? 'COMPATIVEL' : 'DIFERENTE';
}

// ---------------------------------------------------------------------------
// Reconhecimento do layout
// ---------------------------------------------------------------------------

export type CampoFolha =
  | 'orgao'
  | 'matricula'
  | 'nome'
  | 'quadro'
  | 'lotacao'
  | 'cargo'
  | 'valor'
  // ---- Só o EXPORT DO BANCO LEGADO traz estes -----------------------------
  // A folha mensal da Prefeitura não os tem, e por isso todos são opcionais.
  // Eles existem porque o cadastro legado do SINDSERM é MAIS RICO que a folha:
  // tem CPF, contato, datas e o indicador de desconto. Descartar isso na carga
  // inicial obrigaria a secretaria a redigitar 966 fichas.
  | 'cpf'
  | 'telefone'
  | 'email'
  | 'endereco'
  | 'dataNascimento'
  | 'dataAdmissao'
  | 'possuiDesconto';

/**
 * Sinônimos aceitos por coluna.
 *
 * Cada lista é comparada com o cabeçalho normalizado SEM espaços. A folha muda
 * de nome de coluna entre competências ("LOTACAO" vira "UNID. LOTACAO") e
 * exigir o título exato faria o arquivo de agosto ser recusado porque o de
 * julho tinha outro cabeçalho.
 */
const SINONIMOS: Record<CampoFolha, string[]> = {
  // `NAME`, `REGISTRATION`, `POSITION` vêm do export do banco legado do
  // SINDSERM (tabela `members`, com os nomes em inglês). Estão aqui e não num
  // terceiro perfil porque a REGRA DE IDENTIDADE é a mesma — a matrícula —, e
  // é isso que faz a folha do mês seguinte reencontrar quem veio da carga.
  orgao: ['ORGAO', 'ORGAOS', 'SECRETARIA', 'ENTIDADE', 'UNIDADEGESTORA', 'ORGAOLOTACAO'],
  matricula: [
    'MATRICULA', 'MAT', 'NRMATRICULA', 'MATR', 'MATRICULASERVIDOR',
    'MATRICULAFUNCIONAL', 'REGISTRATION',
  ],
  nome: ['NOME', 'NOMESERVIDOR', 'SERVIDOR', 'NOMECOMPLETO', 'NOMEFUNCIONARIO', 'NAME'],
  quadro: ['QUADRO', 'VINCULO', 'TIPOVINCULO', 'REGIME', 'SITUACAOFUNCIONAL'],
  lotacao: ['LOTACAO', 'UNIDLOTACAO', 'UNIDADELOTACAO', 'UNIDADE', 'SETOR', 'LOCALTRABALHO'],
  cargo: ['CARGO', 'FUNCAO', 'CARGOFUNCAO', 'DESCRICAOCARGO', 'POSITION'],
  valor: ['VALOR', 'VLR', 'VALORDESCONTO', 'CONTRIBUICAO', 'MENSALIDADE', 'VALORMENSALIDADE'],

  // ---- Extras do banco legado --------------------------------------------
  // NÃO entra 'EMPRESA' como sinônimo de órgão, de propósito: é a coluna de
  // empregador do CSV legado do SENATEPI, e aceitá-la faria a migração DELE
  // ser lida por este perfil — que ignora o CPF, a única âncora confiável
  // daquela base. Há teste travando isso.
  cpf: ['CPF', 'NRCPF', 'CPFSERVIDOR'],
  telefone: ['TELEFONE', 'FONE', 'CELULAR', 'PHONE', 'TELEFONE1', 'CONTATO'],
  email: ['EMAIL', 'EMAIL1', 'ENDERECOELETRONICO'],
  endereco: ['ENDERECO', 'ADDRESS', 'LOGRADOURO'],
  dataNascimento: ['DATANASCIMENTO', 'NASCIMENTO', 'BIRTHDATE', 'DTNASCIMENTO'],
  dataAdmissao: ['DATAADMISSAO', 'ADMISSAO', 'ADMISSIONDATE', 'DTADMISSAO'],
  possuiDesconto: ['POSSUIDESCONTO', 'DESCONTO', 'DESCONTOEMFOLHA', 'TEMDESCONTO'],
};

function chaveCabecalho(header: string): string {
  return normalizarTexto(header).replace(/[^A-Z0-9]/g, '');
}

export interface ColunaFolha {
  coluna: string;
  campo: CampoFolha | null;
  rotulo: string | null;
}

const ROTULOS: Record<CampoFolha, string> = {
  orgao: 'Órgão',
  matricula: 'Matrícula',
  nome: 'Nome',
  quadro: 'Quadro',
  lotacao: 'Lotação',
  cargo: 'Cargo',
  valor: 'Valor (só sim/não; a quantia é descartada)',
  cpf: 'CPF',
  telefone: 'Telefone',
  email: 'E-mail',
  endereco: 'Endereço',
  dataNascimento: 'Data de nascimento',
  dataAdmissao: 'Data de admissão',
  possuiDesconto: 'Desconto em folha',
};

/** Cabeçalhos do arquivo → campos da folha. Colunas desconhecidas ficam nulas. */
export function mapearColunas(cabecalhos: string[]): ColunaFolha[] {
  const usados = new Set<CampoFolha>();
  return cabecalhos.map((coluna) => {
    const chave = chaveCabecalho(coluna);
    let campo: CampoFolha | null = null;
    for (const [nome, lista] of Object.entries(SINONIMOS) as [CampoFolha, string[]][]) {
      // Um campo só é reivindicado UMA vez: numa planilha com "MATRICULA" e
      // "MATRICULA ANTIGA", a segunda não pode roubar o mapeamento da primeira.
      if (usados.has(nome)) continue;
      if (lista.includes(chave)) {
        campo = nome;
        usados.add(nome);
        break;
      }
    }
    return { coluna, campo, rotulo: campo ? ROTULOS[campo] : null };
  });
}

/**
 * Isto é a folha da Prefeitura?
 *
 * O critério é a presença das três colunas SEM AS QUAIS a importação não teria
 * como funcionar — órgão, matrícula e nome. Quadro/Lotação/Cargo são desejáveis
 * mas não decidem: uma competência pode vir sem "Quadro" e ainda é a folha.
 *
 * Exigir as três evita o falso positivo perigoso: o CSV legado do SENATEPI
 * também tem "nome" e "matrícula", mas não tem "órgão" — e ser lido pelo perfil
 * errado significaria ignorar o CPF de 7.000 pessoas.
 */
export function pareceFolhaPrefeitura(cabecalhos: string[]): boolean {
  const campos = new Set(mapearColunas(cabecalhos).map((c) => c.campo));
  return campos.has('orgao') && campos.has('matricula') && campos.has('nome');
}

// ---------------------------------------------------------------------------
// Linha normalizada
// ---------------------------------------------------------------------------

export interface LinhaFolha {
  orgao: string;
  matricula: string;
  nome: string;
  quadro: string;
  lotacao: string;
  cargo: string;
  /** A matrícula em forma comparável. Vazia quando a linha não trouxe uma. */
  chave: string;
  /**
   * Há desconto em folha? `null` = o arquivo não informou.
   *
   * Sai de `possui_desconto` (export legado) ou de Valor > 0 (folha mensal).
   * A QUANTIA nunca é guardada — nem aqui, nem no banco.
   */
  temDesconto: boolean | null;

  // ---- Só o export legado preenche; a folha mensal deixa vazio ------------
  /** Somente dígitos, e só quando o dígito verificador confere. */
  cpf: string;
  telefone: string;
  email: string;
  endereco: string;
  /** ISO (yyyy-mm-dd) ou vazio. */
  dataNascimento: string;
  dataAdmissao: string;
}

/**
 * "true"/"false" do export legado → booleano.
 *
 * O Postgres exporta `boolean` como `t`/`f` ou `true`/`false` conforme a
 * ferramenta; o Excel, se a coluna passar por lá, vira `VERDADEIRO`. Aceitar as
 * três formas é mais barato que descobrir qual saiu no dia da carga.
 */
export function possuiDescontoLegado(valor?: string | null): boolean | null {
  const v = normalizarTexto(valor);
  if (!v) return null;
  if (['TRUE', 'T', 'SIM', 'S', '1', 'VERDADEIRO', 'Y', 'YES'].includes(v)) return true;
  if (['FALSE', 'F', 'NAO', 'N', '0', 'FALSO', 'NO'].includes(v)) return false;
  return null;
}

/** Uma linha crua do arquivo → campos da folha, já limpos. */
export function normalizarLinha(
  row: Record<string, string>,
  colunas: ColunaFolha[],
): LinhaFolha {
  const porCampo = new Map<CampoFolha, string>();
  for (const c of colunas) {
    if (!c.campo) continue;
    porCampo.set(c.campo, (row[c.coluna] ?? '').trim().replace(/\s+/g, ' '));
  }
  const matricula = porCampo.get('matricula') ?? '';

  // `possui_desconto` (export legado) VENCE `Valor` (folha mensal): é uma
  // afirmação direta do sistema antigo, enquanto o Valor é uma inferência.
  const legado = possuiDescontoLegado(porCampo.get('possuiDesconto'));
  const temDesconto = legado !== null ? legado : descontoNaFolha(porCampo.get('valor'));

  // CPF só entra se o dígito verificador conferir. Um CPF errado gravado é pior
  // que nenhum: vira chave de identidade falsa e ninguém desconfia dele depois.
  const cpfBruto = limparCpf(porCampo.get('cpf'));
  const cpf = !cpfVazioOuPlaceholder(cpfBruto) && cpfValido(cpfBruto) ? cpfBruto : '';

  const iso = (v?: string) => {
    const d = parseData(v);
    return d && d !== 'INVALIDA' ? d.toISOString().slice(0, 10) : '';
  };
  const email = porCampo.get('email') ?? '';

  // `valor` é reduzido a sim/não AQUI e o número é esquecido em seguida — a
  // quantia nunca chega a existir fora desta função, que é a forma de "não
  // importar Valor" que não depende de ninguém lembrar de descartá-lo depois.
  return {
    orgao: porCampo.get('orgao') ?? '',
    matricula,
    nome: porCampo.get('nome') ?? '',
    quadro: porCampo.get('quadro') ?? '',
    lotacao: porCampo.get('lotacao') ?? '',
    cargo: porCampo.get('cargo') ?? '',
    chave: normalizarMatricula(matricula),
    temDesconto,
    cpf,
    telefone: porCampo.get('telefone') ?? '',
    email: emailValido(email) ? email : '',
    endereco: porCampo.get('endereco') ?? '',
    dataNascimento: iso(porCampo.get('dataNascimento')),
    dataAdmissao: iso(porCampo.get('dataAdmissao')),
  };
}

// ---------------------------------------------------------------------------
// Julgamento
// ---------------------------------------------------------------------------

export type Classificacao = 'NOVO' | 'ATUALIZACAO' | 'CONFLITO' | 'DUPLICIDADE' | 'ERRO';
export type Motivo = 'NOME_SEMELHANTE' | 'NOME_DIVERGENTE' | 'CPF_DIVERGENTE';

/** O que o sistema já sabe sobre um vínculo gravado. */
export interface VinculoExistente {
  vinculoId: string;
  filiadoId: string;
  filiadoNome: string;
  orgao: string;
  matricula: string;
  cargo: string | null;
  lotacao: string | null;
  quadro: string | null;
  descontoEmFolha: boolean;
  /** CPF já gravado no cadastro do filiado, quando há. */
  filiadoCpf?: string | null;
}

/** Índices pré-carregados do banco — montados uma vez, usados em todas as linhas. */
export interface BaseAtual {
  /** matrícula normalizada → vínculo. O casamento que identifica a pessoa. */
  porMatricula: Map<string, VinculoExistente>;
  /**
   * matrícula normalizada → filiado cuja MATRÍCULA DE CADASTRO é essa.
   *
   * Existe por causa de quem foi cadastrado no balcão antes da folha chegar:
   * a secretária digitou a matrícula da Prefeitura no cadastro e não criou o
   * vínculo. Sem este índice a importação não acharia a pessoa, tentaria criar
   * outra com a mesma matrícula e esbarraria na unicidade de `filiados`.
   */
  porMatriculaFiliado: Map<string, { filiadoId: string; nome: string }>;
  /** nome normalizado → filiados com esse nome. */
  porNome: Map<string, { filiadoId: string; nome: string }[]>;
}

export interface Alteracao {
  de: string | null;
  para: string;
}

export interface Veredito {
  classificacao: Classificacao;
  motivo?: Motivo;
  /** Cadastro apontado como candidato — para o operador olhar, não para casar. */
  candidatoId?: string;
  vinculoId?: string;
  /** `{campo: {de, para}}` — só o que realmente muda. */
  alteracoes: Record<string, Alteracao>;
  erros: string[];
  avisos: string[];
}

/**
 * CAMPOS DO VÍNCULO QUE A FOLHA MANDA.
 *
 * A folha é a fonte autoritativa do dado FUNCIONAL: se a Prefeitura diz que o
 * cargo mudou, o cargo mudou. `orgao` entra na lista porque a matrícula
 * identifica a PESSOA — vê-la em outra secretaria é uma transferência, e o
 * órgão do vínculo passa a ser o novo.
 *
 * Dado PESSOAL (telefone, endereço, e-mail) não está na folha e por isso nem
 * aparece aqui — não há como a folha estragá-lo.
 */
const CAMPOS_VINCULO = ['cargo', 'lotacao', 'quadro', 'orgao'] as const;

/**
 * O que muda de um vínculo gravado para o que a folha traz.
 *
 * A REGRA QUE NÃO PODE QUEBRAR: **campo vazio na planilha nunca sobrescreve**.
 * Uma competência que veio sem a coluna "Lotação" não pode apagar a lotação de
 * 4.000 pessoas — e apagaria, se o código fizesse `update` cego com o valor
 * lido. Por isso o vazio é PULADO, e não gravado como vazio.
 */
export function diferencasDoVinculo(
  linha: LinhaFolha,
  existente: VinculoExistente | null,
): Record<string, Alteracao> {
  const alteracoes: Record<string, Alteracao> = {};
  for (const campo of CAMPOS_VINCULO) {
    const novo = linha[campo];
    if (!novo) continue; // vazio na planilha: preserva o que está gravado
    const atual = existente ? (existente[campo] ?? null) : null;
    // Comparação normalizada: "Aux. Administrativo" e "AUX. ADMINISTRATIVO"
    // são o mesmo cargo, e gravar um por cima do outro só produziria ruído no
    // histórico e um contador de "atualizados" inflado.
    if (normalizarTexto(atual) === normalizarTexto(novo)) continue;
    alteracoes[campo] = { de: atual, para: novo };
  }

  // Desconto em folha: só entra como alteração quando a planilha INFORMOU
  // (`null` = coluna Valor ausente, e aí não se conclui nada). É o campo que
  // decide se a carteirinha pode ser emitida, então mudá-lo por omissão seria
  // invalidar carteirinha de gente que contribui.
  if (linha.temDesconto !== null) {
    const atual = existente ? existente.descontoEmFolha : false;
    if (atual !== linha.temDesconto)
      alteracoes.descontoEmFolha = {
        de: existente ? String(atual) : null,
        para: String(linha.temDesconto),
      };
  }
  return alteracoes;
}

/**
 * O VEREDITO DE UMA LINHA — a função que decide o destino de cada servidor.
 *
 * `chavesNoArquivo` acumula as chaves já vistas NESTA planilha; a segunda
 * aparição da mesma matrícula é duplicidade do arquivo, não do sistema.
 */
export function classificarLinha(
  linha: LinhaFolha,
  base: BaseAtual,
  chavesNoArquivo: Map<string, number>,
  numeroLinha: number,
): Veredito {
  const erros: string[] = [];
  const avisos: string[] = [];
  const vazio: Veredito = { classificacao: 'ERRO', alteracoes: {}, erros, avisos };

  // --- Obrigatórios ---------------------------------------------------------
  if (!linha.nome) erros.push('Nome em branco — a linha não identifica ninguém.');
  if (!linha.matricula)
    erros.push('Matrícula em branco — sem ela não há como reconhecer o servidor.');
  // Órgão NÃO é obrigatório: quem identifica é a matrícula. Sem órgão a pessoa
  // entra e o vínculo fica sem lotação de origem — informação a menos, mas o
  // servidor não fica de fora do sindicato por causa de uma célula vazia.
  if (erros.length > 0) return vazio;
  if (!linha.orgao) avisos.push('Órgão em branco — o vínculo entra sem o órgão.');

  const chave = linha.chave;

  // --- Duplicidade DENTRO do arquivo ---------------------------------------
  const jaVista = chavesNoArquivo.get(chave);
  if (jaVista !== undefined) {
    return {
      classificacao: 'DUPLICIDADE',
      alteracoes: {},
      erros,
      avisos: [
        `Matrícula ${linha.matricula} repetida no arquivo — já apareceu na ` +
          `linha ${jaVista}. Só a primeira será considerada.`,
      ],
    };
  }
  chavesNoArquivo.set(chave, numeroLinha);

  // --- A matrícula já é de alguém? -----------------------------------------
  // Na Prefeitura a matrícula é única no município: achou, é a pessoa. Inclusive
  // quando o órgão mudou — isso é transferência, e o vínculo é atualizado.
  const exato = base.porMatricula.get(chave);
  if (exato) {
    // Só o nome pode desmentir. Se a matrícula bate e o nome é de outra pessoa,
    // alguma coisa está errada na origem — atualizar aqui gravaria os dados de
    // um servidor por cima da ficha de outro.
    const semelhanca = compararNomes(linha.nome, exato.filiadoNome);
    if (semelhanca === 'DIFERENTE') {
      return {
        classificacao: 'CONFLITO',
        motivo: 'NOME_DIVERGENTE',
        candidatoId: exato.filiadoId,
        vinculoId: exato.vinculoId,
        alteracoes: {},
        erros,
        avisos: [
          `A matrícula ${linha.matricula} está cadastrada para "${exato.filiadoNome}", ` +
            `mas a planilha traz "${linha.nome}".`,
        ],
      };
    }
    if (semelhanca === 'COMPATIVEL')
      avisos.push(`Nome grafado de forma diferente do cadastro ("${exato.filiadoNome}").`);

    // CPF divergente com matrícula igual: são documentos diferentes para a
    // mesma matrícula. Um dos dois está errado, e o sistema não tem como saber
    // qual — completar ou sobrescrever aqui carimbaria a identidade errada em
    // alguém. Vai para decisão humana.
    if (linha.cpf && exato.filiadoCpf && linha.cpf !== exato.filiadoCpf) {
      return {
        classificacao: 'CONFLITO',
        motivo: 'CPF_DIVERGENTE',
        candidatoId: exato.filiadoId,
        vinculoId: exato.vinculoId,
        alteracoes: {},
        erros,
        avisos: [
          `A matrícula ${linha.matricula} está cadastrada com outro CPF. ` +
            `O arquivo traz um CPF diferente do que está no cadastro de "${exato.filiadoNome}".`,
        ],
      };
    }

    const alteracoes = diferencasDoVinculo(linha, exato);
    if (alteracoes.orgao)
      avisos.push(
        `Mudou de "${alteracoes.orgao.de ?? '(sem órgão)'}" para "${alteracoes.orgao.para}" — ` +
          `transferência; o vínculo é o mesmo.`,
      );

    return {
      classificacao: 'ATUALIZACAO',
      candidatoId: exato.filiadoId,
      vinculoId: exato.vinculoId,
      alteracoes,
      erros,
      avisos:
        Object.keys(alteracoes).length === 0
          ? [...avisos, 'Nada mudou — o cadastro já está igual à planilha.']
          : avisos,
    };
  }

  // --- Cadastrado no balcão, sem vínculo criado ----------------------------
  // A matrícula da Prefeitura está no cadastro do filiado, mas ninguém criou o
  // vínculo. É a mesma pessoa (matrícula é única), e a folha vem completar o
  // que faltou — desde que o nome não desminta.
  const noCadastro = base.porMatriculaFiliado.get(chave);
  if (noCadastro) {
    if (compararNomes(linha.nome, noCadastro.nome) === 'DIFERENTE') {
      return {
        classificacao: 'CONFLITO',
        motivo: 'NOME_DIVERGENTE',
        candidatoId: noCadastro.filiadoId,
        alteracoes: {},
        erros,
        avisos: [
          `A matrícula ${linha.matricula} é a do cadastro de "${noCadastro.nome}", ` +
            `mas a planilha traz "${linha.nome}".`,
        ],
      };
    }
    return {
      classificacao: 'ATUALIZACAO',
      candidatoId: noCadastro.filiadoId,
      alteracoes: diferencasDoVinculo(linha, null),
      erros,
      avisos: [
        ...avisos,
        `Já cadastrado com esta matrícula, mas sem vínculo funcional — a folha ` +
          `vai criar o vínculo.`,
      ],
    };
  }

  // --- Nome igual ao de alguém já cadastrado -------------------------------
  // AQUI É O PONTO EM QUE NÃO SE FUNDE NADA. Nome batendo com matrícula nova é,
  // com igual probabilidade, o segundo vínculo de quem já é filiado ou um
  // homônimo — e "MARIA DA SILVA" é homônimo de muita gente. Quem decide é
  // quem tem a ficha na mão.
  const homonimos = base.porNome.get(normalizarTexto(linha.nome)) ?? [];
  if (homonimos.length > 0) {
    return {
      classificacao: 'CONFLITO',
      motivo: 'NOME_SEMELHANTE',
      candidatoId: homonimos[0].filiadoId,
      alteracoes: {},
      erros,
      avisos: [
        homonimos.length === 1
          ? `Já existe um cadastro com este nome. Pode ser um segundo vínculo da ` +
            `mesma pessoa ou um homônimo — o sistema não decide isso sozinho.`
          : `Já existem ${homonimos.length} cadastros com este nome. ` +
            `Confirme de quem é a matrícula ${linha.matricula}.`,
      ],
    };
  }

  // --- Ninguém parecido: é gente nova --------------------------------------
  return {
    classificacao: 'NOVO',
    alteracoes: diferencasDoVinculo(linha, null),
    erros,
    avisos,
  };
}

/**
 * Campos a gravar num filiado JÁ EXISTENTE.
 *
 * Devolve apenas o que está VAZIO no cadastro e preenchido na planilha — a
 * folha completa lacunas, nunca sobrescreve. O nome é o caso a observar: se o
 * cadastro já tem nome, o da planilha é ignorado (e a divergência já foi
 * registrada como aviso na classificação). É de propósito: alguém pode ter
 * corrigido "MARIA D SILVA" para "MARIA DA SILVA" na mão, e a folha voltaria
 * a estragar a correção a cada competência.
 */
export function camposParaCompletar(
  linha: LinhaFolha,
  atual: {
    nomeCompleto?: string | null;
    cpf?: string | null;
    telefonePrincipal?: string | null;
    email?: string | null;
    endereco?: string | null;
    dataNascimento?: Date | string | null;
    dataAdmissao?: Date | string | null;
  },
): Record<string, string> {
  const preencher: Record<string, string> = {};
  const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

  if (linha.nome && vazio(atual.nomeCompleto)) preencher.nomeCompleto = linha.nome;
  // CPF é o caso mais delicado: preenche o que falta, mas NUNCA troca um CPF já
  // gravado. Trocar seria reescrever a identidade de alguém a partir de um
  // arquivo — e um CPF divergente é sinal de conflito, não de correção.
  if (linha.cpf && vazio(atual.cpf)) preencher.cpf = linha.cpf;
  if (linha.telefone && vazio(atual.telefonePrincipal)) preencher.telefonePrincipal = linha.telefone;
  if (linha.email && vazio(atual.email)) preencher.email = linha.email;
  if (linha.endereco && vazio(atual.endereco)) preencher.endereco = linha.endereco;
  if (linha.dataNascimento && vazio(atual.dataNascimento))
    preencher.dataNascimento = linha.dataNascimento;
  if (linha.dataAdmissao && vazio(atual.dataAdmissao)) preencher.dataAdmissao = linha.dataAdmissao;
  return preencher;
}
