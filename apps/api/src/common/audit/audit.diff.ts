/**
 * O QUE MUDOU, CAMPO A CAMPO — "de" e "para".
 *
 * O BURACO QUE ISTO FECHA. A auditoria dizia "Dr. Murilo alterou" e parava aí.
 * Alterou o quê? Estava como antes? Ficou como agora? Sem isso o log responde
 * apenas "alguém mexeu", que é a metade inútil da pergunta: ninguém consegue
 * conferir uma alteração, nem desfazê-la, nem saber se ela foi a que se pediu.
 *
 * Medido na produção em 04/09/2026: das 400 alterações mais recentes, as que
 * passavam pelas rotas genéricas (`PATCH /filiados/:id`, `/compromissos/:id`,
 * `/atendimentos/:id/status`) tinham `metadata` NULO — nada além do verbo.
 *
 * ONDE ISTO NÃO SE APLICA. Ato que não é edição de campo — desfiliar, concluir
 * uma atividade, importar um processo — já tem frase própria com o dado que
 * importa. Diff ali seria ruído: ninguém precisa ver `situacao: ATIVO →
 * DESFILIADO` embaixo de "Desfiliação de MARIA — Solicitação Pessoal".
 */

/** O que cabe num "de → para": escalar ou lista. Nada de objeto aninhado. */
export type ValorDeCampo = string | number | boolean | null | string[];

/**
 * Uma diferença, pronta para a tela e para o CSV.
 *
 * `type` e não `interface` de propósito: o Prisma exige que o conteúdo de uma
 * coluna Json seja atribuível a `InputJsonValue`, e só os aliases de tipo
 * ganham a assinatura de índice implícita que essa checagem pede. Com
 * `interface`, gravar o diff exigiria um cast — e cast é onde o erro se
 * esconde.
 */
export type AlteracaoDeCampo = {
  campo: string;
  /** Nome em português. É o que a tela mostra. */
  label: string;
  de: ValorDeCampo;
  para: ValorDeCampo;
};

/**
 * CAMPOS QUE NUNCA VÃO PARA O LOG COM VALOR.
 *
 * Auditoria é lida por coordenação e administração, exportada em CSV e guardada
 * por anos. Hash de senha, token e segredo não têm por que estar num registro
 * cuja função é dizer QUE algo mudou — e um deles vazado num CSV é um problema
 * de outra ordem. O campo continua aparecendo (a mudança é o fato); o valor
 * vira `«oculto»` dos dois lados.
 */
const NUNCA_MOSTRAR = /senha|hash|token|secret|segredo/i;
const OCULTO = '«oculto»';

/**
 * NOMES EM PORTUGUÊS.
 *
 * Uma tabela só, compartilhada: o mesmo campo aparece em telas diferentes e
 * precisa ter o mesmo nome nas duas. O que não estiver aqui cai no próprio
 * nome do campo — feio, mas honesto, e visível o bastante para alguém
 * acrescentar a linha que falta.
 */
export const NOME_DO_CAMPO: Record<string, string> = {
  // Pessoas
  nomeCompleto: 'Nome',
  nomeExibicao: 'Nome de exibição',
  nomeSocial: 'Nome social',
  cpf: 'CPF',
  rg: 'RG',
  dataNascimento: 'Data de nascimento',
  dataAdmissao: 'Data de admissão',
  email: 'E-mail',
  telefonePrincipal: 'Telefone',
  telefoneSecundario: 'Telefone secundário',
  situacao: 'Situação',
  matricula: 'Matrícula',
  numeroCoren: 'COREN',
  formacao: 'Formação',
  cidade: 'Cidade',
  estado: 'Estado',
  uf: 'UF',
  cep: 'CEP',
  logradouro: 'Endereço',
  bairro: 'Bairro',
  numero: 'Número',
  complemento: 'Complemento',
  sexo: 'Sexo',
  estadoCivil: 'Estado civil',
  vinculoFuncional: 'Vínculo funcional',
  observacoes: 'Observações',
  ativo: 'Ativo',
  role: 'Perfil',

  // Processo
  numeroCNJ: 'Número do processo',
  statusInterno: 'Situação do processo',
  tipoAcao: 'Tipo de ação',
  categoria: 'Área jurídica',
  etiquetas: 'Etiquetas',
  valorCausa: 'Valor da causa',
  advogadoId: 'Advogado responsável',
  filiadoId: 'Filiado vinculado',
  tribunal: 'Tribunal',
  classeProcessual: 'Classe processual',
  assuntoPrincipal: 'Assunto',
  fase: 'Fase',

  // Agenda
  titulo: 'Título',
  descricao: 'Descrição',
  tipo: 'Tipo',
  status: 'Andamento',
  inicio: 'Início',
  fim: 'Fim',
  local: 'Local',
  responsavelId: 'Responsável',
  urgente: 'Urgente',
  urgenteMotivo: 'Motivo da urgência',
  processoId: 'Processo',

  // Atendimento
  canal: 'Canal',
  setor: 'Setor',
  desfecho: 'Desfecho',
  assunto: 'Assunto',

  // Organização
  nome: 'Nome',
  nomeFantasia: 'Nome fantasia',
  documento: 'CNPJ / CPF',
  institucional: 'É o próprio sindicato',
};

/** Data vira ISO; lista vira lista ordenada; o resto vira escalar ou nulo. */
function normalizar(v: unknown): ValorDeCampo {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return [...v].map(String).sort();
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  // Decimal do Prisma e afins: o texto é o que interessa no log.
  return String(v);
}

/** Objeto comum (`{}`), que não cabe num "de → para" — diferente de um Decimal. */
function ehObjetoComum(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v) || v instanceof Date) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Duas listas com os mesmos itens não são uma alteração. */
function iguais(a: unknown, b: unknown): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  if (Array.isArray(x) || Array.isArray(y)) return JSON.stringify(x) === JSON.stringify(y);
  // `null` e `''` são a mesma ausência para quem lê o log: trocar um pelo
  // outro não é alteração de cadastro, é detalhe de como o formulário envia.
  const vazio = (v: unknown) => v === null || v === '';
  if (vazio(x) && vazio(y)) return true;
  if (x === null || y === null) return false;
  /*
    COMPARAÇÃO POR TEXTO, e não por identidade.

    `valorCausa` sai do banco como Decimal do Prisma e volta do formulário como
    número JSON. São o mesmo valor e tipos diferentes: `===` diria que mudou, e
    reenviar o formulário sem editar nada gravaria "Valor da causa: 1234.56 →
    1234.56" no log de auditoria.
  */
  return String(x) === String(y);
}

/**
 * AS DIFERENÇAS ENTRE O QUE ERA E O QUE FICOU.
 *
 * Compara SÓ o que o formulário enviou (`depois`), e não o registro inteiro:
 * um PATCH parcial não é uma declaração sobre os campos que ele omitiu, e
 * listá-los como "de X para X" encheria o log de linhas que não mudaram nada.
 */
export function diferencaDeCampos(
  antes: Record<string, unknown> | null | undefined,
  depois: Record<string, unknown> | null | undefined,
  opcoes: { ignorar?: string[] } = {},
): AlteracaoDeCampo[] {
  if (!antes || !depois) return [];
  const ignorar = new Set([
    'id', 'createdAt', 'updatedAt', 'senhaHash',
    ...(opcoes.ignorar ?? []),
  ]);

  const saida: AlteracaoDeCampo[] = [];
  for (const [campo, novo] of Object.entries(depois)) {
    if (ignorar.has(campo)) continue;
    if (novo === undefined) continue;
    /*
      Relação inteira (vínculos, dependentes) não cabe numa linha de "de → para".

      SÓ OBJETO COMUM, e não "qualquer objeto": eu descartava também o Decimal
      do Prisma, que é objeto e É um valor — uma alteração de valor da causa
      vinda do banco sumiria do log sem aviso.
    */
    if (ehObjetoComum(novo)) continue;
    if (iguais(antes[campo], novo)) continue;

    const sigiloso = NUNCA_MOSTRAR.test(campo);
    saida.push({
      campo,
      label: NOME_DO_CAMPO[campo] ?? campo,
      de: sigiloso ? OCULTO : (normalizar(antes[campo]) ?? null),
      para: sigiloso ? OCULTO : normalizar(novo),
    });
  }
  return saida;
}

/**
 * A FRASE DE UMA ALTERAÇÃO, com os campos citados.
 *
 * "Alterou em filiados" não diz nada; "Alterou telefone e cidade de MARIA DA
 * SILVA" responde a pergunta na própria lista, sem abrir o detalhe. Acima de
 * três campos a enumeração vira parede de texto e o número serve melhor.
 */
export function fraseDaAlteracao(
  oQue: string,
  alteracoes: AlteracaoDeCampo[],
): string {
  if (!alteracoes.length) return `${oQue} — nada mudou`;
  const nomes = alteracoes.map((a) => a.label.toLowerCase());
  if (nomes.length === 1) return `${oQue} — ${nomes[0]}`;
  if (nomes.length <= 3) {
    return `${oQue} — ${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  }
  return `${oQue} — ${nomes.length} campos (${nomes.slice(0, 3).join(', ')}…)`;
}
