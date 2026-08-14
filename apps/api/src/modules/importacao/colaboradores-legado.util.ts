import { BadRequestException } from '@nestjs/common';
import { StatusColaborador, TipoDependente, TipoVinculo } from '@prisma/client';

import {
  cpfValido,
  cpfVazioOuPlaceholder,
  emailValido,
  limparCpf,
  normalizarChave,
  parseData,
} from './mapeamento.util';

/**
 * A EQUIPE DO SINDICATO VINDA DO SISTEMA ANTIGO — leitura e normalização.
 *
 * Funções puras, sem Prisma e sem Nest: tudo aqui é "texto que veio do arquivo"
 * → "registro que o sistema entende, com a lista do que está errado nele". O
 * serviço só decide o que fazer com o veredito. É o mesmo desenho de
 * `folha-prefeitura.util.ts`, e pelo mesmo motivo: a regra que decide se um dado
 * entra no cadastro precisa ser testável sem banco.
 *
 * ISTO NÃO É A FOLHA DA PREFEITURA. Lá são ~4.000 FILIADOS e a âncora é a
 * matrícula, porque a folha não traz CPF. Aqui são algumas dezenas de
 * COLABORADORES — funcionários e prestadores do próprio sindicato — e a âncora é
 * o CPF, que `colaboradores.cpf` exige e mantém único. São duas identidades
 * opostas sobre duas populações diferentes; juntá-las num serviço só produziria
 * um `if (perfil)` dentro do código que decide se duas pessoas são a mesma.
 */

// ---------------------------------------------------------------------------
// O registro canônico
// ---------------------------------------------------------------------------

export interface DependenteLegado {
  nome: string;
  cpf: string | null;
  tipo: TipoDependente;
  /** YYYY-MM-DD — obrigatório: `dependentes.data_nascimento` é NOT NULL. */
  dataNascimento: string;
}

export interface ColaboradorLegado {
  matricula: string | null;
  nome: string;
  cpf: string;
  cargo: string;
  setor: string;
  tipoVinculo: TipoVinculo;
  empresaNome: string | null;
  dataAdmissao: string | null;
  dataNascimento: string | null;
  telefone: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  status: StatusColaborador;
  statusMotivo: string | null;
  dependentes: DependenteLegado[];
}

export interface LinhaNormalizada {
  /** Posição no arquivo (1 = primeiro registro), para a mensagem de erro. */
  numero: number;
  dados: ColaboradorLegado;
  /** Impedem a importação da linha. */
  erros: string[];
  /** Não impedem: o registro entra, e isto é o que o operador precisa conferir. */
  avisos: string[];
  /** Códigos para o resumo agrupado — ver `CODIGO_LABEL_COLABORADOR`. */
  codigos: string[];
  /**
   * Preenchido pela COMPARAÇÃO COM A BASE, que é do serviço — o normalizador
   * não conhece banco. Os dois campos abaixo nascem vazios aqui de propósito:
   * é o que separa "o que o arquivo diz" de "o que isso significa para esta
   * instalação".
   */
  existente?: { id: string; nome: string };
  /** `{campo: {de, para}}` — o que esta linha muda em quem já existe. */
  alteracoes?: Record<string, { de: unknown; para: unknown }>;
}

/** Rótulos do resumo "N linhas com este problema". */
export const CODIGO_LABEL_COLABORADOR: Record<string, string> = {
  NOME_AUSENTE: 'Nome ausente',
  CPF_AUSENTE: 'CPF ausente ou de preenchimento (000…, 111…)',
  CPF_INVALIDO: 'CPF inválido (dígito verificador)',
  CPF_DUP_ARQUIVO: 'CPF repetido no arquivo',
  MATRICULA_DUP_ARQUIVO: 'Matrícula repetida no arquivo',
  MATRICULA_DE_OUTRA_PESSOA: 'Matrícula já pertence a outro colaborador',
  VINCULO_DESCONHECIDO: 'Tipo de contrato não reconhecido',
  CARGO_AUSENTE: 'Cargo em branco — entrou como "Não informado"',
  SETOR_AUSENTE: 'Setor em branco — entrou como "Não informado"',
  STATUS_DESCONHECIDO: 'Situação não reconhecida — entrou como Inativo',
  DATA_INVALIDA: 'Data em formato inválido',
  EMAIL_INVALIDO: 'E-mail inválido — não importado',
  DEPENDENTE_DESCARTADO: 'Dependente descartado (parentesco, nome ou nascimento)',
  CONJUGE_DUPLICADO: 'Mais de um cônjuge — só o primeiro entrou',
  EMPRESA_EM_CLT: 'Funcionário CLT com empresa contratante preenchida',
};

/** Usado quando a origem não traz cargo/setor — a FK dos dois é obrigatória. */
export const NAO_INFORMADO = 'Não informado';

// ---------------------------------------------------------------------------
// Dicionários de tradução
// ---------------------------------------------------------------------------

/**
 * `tipo_contrato` → vínculo.
 *
 * `prestador` vira PJ, e não TERCEIRIZADO: terceirizado é quem chega POR uma
 * empresa que administra o contrato de trabalho; prestador é quem contrata
 * direto. Quem tiver de fato terceirizados escreve a palavra no arquivo — ela
 * está aceita aqui.
 */
const VINCULO_POR_TEXTO: Record<string, TipoVinculo> = {
  funcionario: TipoVinculo.CLT,
  empregado: TipoVinculo.CLT,
  clt: TipoVinculo.CLT,
  efetivo: TipoVinculo.CLT,
  prestador: TipoVinculo.PJ,
  prestador_de_servico: TipoVinculo.PJ,
  prestador_de_servicos: TipoVinculo.PJ,
  autonomo: TipoVinculo.PJ,
  pj: TipoVinculo.PJ,
  estagio: TipoVinculo.ESTAGIO,
  estagiario: TipoVinculo.ESTAGIO,
  terceirizado: TipoVinculo.TERCEIRIZADO,
  terceiro: TipoVinculo.TERCEIRIZADO,
};

/**
 * `status` → situação.
 *
 * Aceita o inglês do banco antigo (`active`/`inactive`) e o português que
 * qualquer reexportação produz. O que NÃO estiver aqui cai em INATIVO — ver
 * `traduzirStatus`.
 */
const STATUS_POR_TEXTO: Record<string, StatusColaborador> = {
  active: StatusColaborador.ATIVO,
  ativo: StatusColaborador.ATIVO,
  ativa: StatusColaborador.ATIVO,
  a: StatusColaborador.ATIVO,
  '1': StatusColaborador.ATIVO,
  inactive: StatusColaborador.INATIVO,
  inativo: StatusColaborador.INATIVO,
  inativa: StatusColaborador.INATIVO,
  i: StatusColaborador.INATIVO,
  '0': StatusColaborador.INATIVO,
  afastado: StatusColaborador.AFASTADO,
  afastada: StatusColaborador.AFASTADO,
  licenca: StatusColaborador.AFASTADO,
  ferias: StatusColaborador.FERIAS,
  desligado: StatusColaborador.DESLIGADO,
  desligada: StatusColaborador.DESLIGADO,
  demitido: StatusColaborador.DESLIGADO,
  demitida: StatusColaborador.DESLIGADO,
  rescindido: StatusColaborador.DESLIGADO,
  terminated: StatusColaborador.DESLIGADO,
};

/**
 * `parentesco` → tipo de dependente.
 *
 * ENTEADO ENTRA COMO FILHO, com aviso. Não é descuido: o dependente existe aqui
 * para entrar acompanhando o titular, e nisso enteado e filho são a mesma coisa
 * — inclusive no limite de idade. O aviso existe porque a origem sabia
 * distinguir e o sistema não vai saber.
 *
 * O QUE NÃO ESTÁ AQUI É DESCARTADO, com o nome na tela. Neto, irmão, sogra e
 * afins não têm tradução honesta em `TipoDependente`, e chutar FILHO num neto
 * daria a ele o limite de 18 anos de outra pessoa. É pouca gente e se cadastra
 * à mão depois — se um dia for muita, o caminho é o enum ganhar o valor, não
 * este mapa ganhar um chute.
 */
const PARENTESCO_POR_TEXTO: Record<string, TipoDependente> = {
  conjuge: TipoDependente.CONJUGE,
  esposo: TipoDependente.CONJUGE,
  esposa: TipoDependente.CONJUGE,
  marido: TipoDependente.CONJUGE,
  mulher: TipoDependente.CONJUGE,
  companheiro: TipoDependente.CONJUGE,
  companheira: TipoDependente.CONJUGE,
  filho: TipoDependente.FILHO,
  filha: TipoDependente.FILHO,
  filhoa: TipoDependente.FILHO,
  filho_a: TipoDependente.FILHO,
  pai: TipoDependente.PAI,
  genitor: TipoDependente.PAI,
  mae: TipoDependente.MAE,
  genitora: TipoDependente.MAE,
};

/** Parentescos traduzidos com perda — entram, mas o operador é avisado. */
const PARENTESCO_APROXIMADO: Record<string, TipoDependente> = {
  enteado: TipoDependente.FILHO,
  enteada: TipoDependente.FILHO,
  enteadoa: TipoDependente.FILHO,
  tutelado: TipoDependente.FILHO,
  tutelada: TipoDependente.FILHO,
};

// ---------------------------------------------------------------------------
// Leitura do arquivo → registros brutos
// ---------------------------------------------------------------------------

/** Um registro cru, com as chaves já normalizadas (`data_admissao`, `cpf`…). */
export type RegistroBruto = Record<string, unknown>;

/**
 * O que o arquivo entrega, seja ele JSON ou CSV.
 *
 * `dependentes` já vem resolvido: o JSON traz aninhado, e as duas formas de CSV
 * são convertidas para a mesma coisa aqui. Do normalizador para baixo existe UM
 * formato — sem isso, cada regra de validação teria de saber de que arquivo
 * veio, que é como um importador começa a divergir de si mesmo.
 */
export interface RegistroComDependentes {
  pessoa: RegistroBruto;
  dependentes: RegistroBruto[];
}

const MAX_REGISTROS = 20_000;

/** Chaves aceitas para cada campo — a origem varia no acento e no separador. */
const ALIASES: Record<string, string[]> = {
  matricula: ['matricula', 'matricula_funcional', 'codigo', 'registro'],
  nome: ['nome', 'nome_completo', 'funcionario', 'colaborador'],
  cpf: ['cpf', 'documento'],
  cargo: ['cargo', 'funcao', 'ocupacao'],
  setor: ['setor', 'departamento', 'lotacao', 'area'],
  tipo_contrato: ['tipo_contrato', 'tipo', 'vinculo', 'tipo_vinculo', 'contrato'],
  empresa: ['empresa', 'contratante', 'empregador'],
  data_admissao: ['data_admissao', 'admissao', 'dt_admissao'],
  data_nascimento: ['data_nascimento', 'nascimento', 'dt_nascimento', 'data_nasc'],
  telefone: ['telefone', 'celular', 'fone', 'contato'],
  email: ['email', 'e_mail'],
  endereco: ['endereco', 'logradouro', 'rua'],
  numero: ['numero', 'num', 'nro'],
  bairro: ['bairro'],
  cidade: ['cidade', 'municipio'],
  uf: ['uf', 'estado'],
  cep: ['cep'],
  status: ['status', 'situacao', 'ativo'],
  parentesco: ['parentesco', 'grau_parentesco', 'relacao', 'tipo'],
  cpf_titular: ['cpf_titular', 'cpf_responsavel', 'titular_cpf'],
  matricula_titular: ['matricula_titular', 'matricula_responsavel', 'titular_matricula'],
};

/** Lê um campo por qualquer um dos seus apelidos. */
export function campo(registro: RegistroBruto, nome: keyof typeof ALIASES): string {
  for (const alias of ALIASES[nome]) {
    const v = registro[alias];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * JSON → registros. Aceita o array direto ou embrulhado (`{ dados: [...] }`),
 * que é como metade dos exports de sistema antigo sai.
 */
export function lerJson(buffer: Buffer): RegistroComDependentes[] {
  let texto = buffer.toString('utf8');
  if (texto.includes('�')) texto = buffer.toString('latin1');
  texto = texto.replace(/^﻿/, '').trim();

  let cru: unknown;
  try {
    cru = JSON.parse(texto);
  } catch (e) {
    throw new BadRequestException(
      `O arquivo não é um JSON válido: ${(e as Error).message}. ` +
        'Se for uma planilha, salve como .csv e envie de novo.',
    );
  }

  const lista = Array.isArray(cru)
    ? cru
    : Array.isArray((cru as Record<string, unknown>)?.dados)
      ? ((cru as Record<string, unknown>).dados as unknown[])
      : Array.isArray((cru as Record<string, unknown>)?.colaboradores)
        ? ((cru as Record<string, unknown>).colaboradores as unknown[])
        : null;

  if (!lista)
    throw new BadRequestException(
      'O JSON precisa ser uma LISTA de pessoas (ou um objeto com a lista em ' +
        '"dados"/"colaboradores"). Recebi um objeto solto.',
    );
  if (lista.length === 0) throw new BadRequestException('O arquivo não tem nenhum registro.');
  if (lista.length > MAX_REGISTROS)
    throw new BadRequestException(
      `O arquivo tem ${lista.length} registros e o limite é ${MAX_REGISTROS}. ` +
        'Isto costuma ser sinal de arquivo trocado — a equipe de um sindicato tem dezenas.',
    );

  return lista.map((item) => {
    const pessoa = comChavesNormalizadas(item);
    const brutos = pessoa['dependentes'];
    delete pessoa['dependentes'];
    return {
      pessoa,
      dependentes: Array.isArray(brutos) ? brutos.map(comChavesNormalizadas) : [],
    };
  });
}

/**
 * CSV → registros. Duas formas, porque as duas aparecem em export legado:
 *
 *  (a) LINHA DE DEPENDENTE, marcada por `cpf_titular` (ou `matricula_titular`)
 *      preenchido. É a forma que um banco relacional exporta naturalmente.
 *  (b) COLUNAS NUMERADAS na própria linha da pessoa: `dependente_1_nome`,
 *      `dependente_1_parentesco`, … É a forma que uma planilha montada à mão tem.
 *
 * As duas convivem no mesmo arquivo sem ambiguidade: (a) se distingue por ter
 * titular, (b) por ter as colunas numeradas.
 *
 * A ORDEM DO ARQUIVO NÃO IMPORTA — o titular é procurado depois de ler tudo.
 * Exigir que o dependente venha abaixo do titular transformaria um `ORDER BY`
 * diferente na origem em "23 dependentes sumiram", sem erro nenhum na tela.
 */
export function lerCsv(linhas: Record<string, string>[]): RegistroComDependentes[] {
  if (linhas.length > MAX_REGISTROS)
    throw new BadRequestException(
      `O arquivo tem ${linhas.length} linhas e o limite é ${MAX_REGISTROS}.`,
    );

  const normalizadas = linhas.map(comChavesNormalizadas);
  const pessoas: RegistroComDependentes[] = [];
  const soltos: RegistroBruto[] = [];

  for (const linha of normalizadas) {
    const titular = campo(linha, 'cpf_titular') || campo(linha, 'matricula_titular');
    if (titular) {
      soltos.push(linha);
      continue;
    }
    pessoas.push({ pessoa: linha, dependentes: dependentesEmColunas(linha) });
  }

  // Índice do titular pelas duas chaves possíveis. CPF primeiro: é o único que
  // não se repete entre pessoas.
  const porCpf = new Map<string, RegistroComDependentes>();
  const porMatricula = new Map<string, RegistroComDependentes>();
  for (const p of pessoas) {
    const cpf = limparCpf(campo(p.pessoa, 'cpf'));
    if (cpf) porCpf.set(cpf, p);
    const mat = campo(p.pessoa, 'matricula').toUpperCase();
    if (mat) porMatricula.set(mat, p);
  }

  for (const dep of soltos) {
    const cpfTitular = limparCpf(campo(dep, 'cpf_titular'));
    const matTitular = campo(dep, 'matricula_titular').toUpperCase();
    const dono = (cpfTitular && porCpf.get(cpfTitular)) || (matTitular && porMatricula.get(matTitular));
    if (dono) {
      dono.dependentes.push(dep);
    } else {
      /**
       * DEPENDENTE SEM TITULAR NO ARQUIVO vira uma linha de erro própria, com o
       * nome do titular que ele procurava. Descartar em silêncio seria a pior
       * saída: o total bateria e a família de alguém simplesmente não existiria.
       */
      pessoas.push({ pessoa: { __dependente_orfao: true, ...dep }, dependentes: [] });
    }
  }

  if (pessoas.length === 0) throw new BadRequestException('O arquivo não tem nenhum registro.');
  return pessoas;
}

/** `dependente_1_nome`, `dep2_parentesco`… → lista de registros. */
function dependentesEmColunas(linha: RegistroBruto): RegistroBruto[] {
  const porIndice = new Map<number, RegistroBruto>();
  for (const [chave, valor] of Object.entries(linha)) {
    const m = /^dep(?:endente)?_?(\d+)_(.+)$/.exec(chave);
    if (!m) continue;
    const indice = Number(m[1]);
    const sub = m[2];
    const atual = porIndice.get(indice) ?? {};
    atual[sub] = valor;
    porIndice.set(indice, atual);
  }
  return [...porIndice.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v)
    // Bloco numerado vazio é o normal: a planilha reserva 5 colunas e a pessoa
    // tem 1 dependente.
    .filter((d) => Object.values(d).some((v) => String(v ?? '').trim() !== ''));
}

function comChavesNormalizadas(item: unknown): RegistroBruto {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return {};
  const saida: RegistroBruto = {};
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    saida[normalizarChave(k)] = v;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Normalização e validação de UMA pessoa
// ---------------------------------------------------------------------------

export function normalizarRegistro(
  registro: RegistroComDependentes,
  numero: number,
): LinhaNormalizada {
  const erros: string[] = [];
  const avisos: string[] = [];
  const codigos: string[] = [];
  const { pessoa } = registro;

  if (pessoa['__dependente_orfao']) {
    return {
      numero,
      dados: vazio(),
      erros: [
        `Esta linha é um dependente ("${campo(pessoa, 'nome') || 'sem nome'}") cujo ` +
          `titular (CPF ${campo(pessoa, 'cpf_titular') || campo(pessoa, 'matricula_titular')}) ` +
          'não está no arquivo.',
      ],
      avisos: [],
      codigos: ['DEPENDENTE_ORFAO'],
    };
  }

  // ---- Nome -----------------------------------------------------------------
  const nome = campo(pessoa, 'nome');
  if (!nome) {
    erros.push('Nome ausente.');
    codigos.push('NOME_AUSENTE');
  }

  // ---- CPF: a âncora --------------------------------------------------------
  //
  // Diferente da importação de filiados, aqui o CPF NÃO É OPCIONAL:
  // `colaboradores.cpf` é NOT NULL e único. Sem ele não há como criar o
  // registro nem como reconhecer a pessoa numa segunda carga — e uma segunda
  // carga sem reconhecimento duplica a equipe inteira.
  const cpfBruto = campo(pessoa, 'cpf');
  let cpf = '';
  if (cpfVazioOuPlaceholder(cpfBruto)) {
    erros.push('CPF ausente (ou de preenchimento, como 000.000.000-00).');
    codigos.push('CPF_AUSENTE');
  } else if (!cpfValido(cpfBruto)) {
    erros.push(`CPF inválido: ${cpfBruto}.`);
    codigos.push('CPF_INVALIDO');
  } else {
    cpf = limparCpf(cpfBruto);
  }

  // ---- Vínculo --------------------------------------------------------------
  const tipoTexto = normalizarChave(campo(pessoa, 'tipo_contrato'));
  const tipoVinculo = VINCULO_POR_TEXTO[tipoTexto];
  if (!tipoVinculo) {
    erros.push(
      `Tipo de contrato "${campo(pessoa, 'tipo_contrato') || '(vazio)'}" não reconhecido. ` +
        'Use funcionario, prestador, estagio ou terceirizado.',
    );
    codigos.push('VINCULO_DESCONHECIDO');
  }

  // ---- Cargo e setor --------------------------------------------------------
  //
  // `cargo_id` e `departamento_id` são FK OBRIGATÓRIAS. Barrar a pessoa por um
  // cargo em branco seria perder o cadastro inteiro por um campo que a
  // secretaria preenche em dois cliques; "Não informado" deixa o registro
  // existir e a pendência VISÍVEL — ela aparece na lista filtrando por cargo.
  let cargo = campo(pessoa, 'cargo');
  if (!cargo) {
    cargo = NAO_INFORMADO;
    avisos.push('Cargo em branco — entrou como "Não informado".');
    codigos.push('CARGO_AUSENTE');
  }
  let setor = campo(pessoa, 'setor');
  if (!setor) {
    setor = NAO_INFORMADO;
    avisos.push('Setor em branco — entrou como "Não informado".');
    codigos.push('SETOR_AUSENTE');
  }

  // ---- Situação -------------------------------------------------------------
  const { status, statusMotivo, desconhecido } = traduzirStatus(campo(pessoa, 'status'));
  if (desconhecido) {
    avisos.push(
      `Situação "${campo(pessoa, 'status')}" não reconhecida — entrou como INATIVO ` +
        'para não liberar a portaria por engano. Ajuste na ficha.',
    );
    codigos.push('STATUS_DESCONHECIDO');
  }

  // ---- Empresa contratante --------------------------------------------------
  const empresaTexto = campo(pessoa, 'empresa');
  let empresaNome: string | null = empresaTexto || null;
  if (tipoVinculo === TipoVinculo.CLT || tipoVinculo === TipoVinculo.ESTAGIO) {
    // CLT do sindicato não tem "empresa contratante" — o empregador é o próprio
    // sindicato, e `aplicarRegrasVinculo` limpa o campo. Só avisa quando o valor
    // sugere OUTRO empregador, que costuma significar `tipo_contrato` errado na
    // origem.
    if (empresaNome) {
      avisos.push(
        `Empresa "${empresaNome}" ignorada: em vínculo CLT/estágio o empregador é o ` +
          'próprio sindicato. Se esta pessoa é contratada por terceiro, corrija o ' +
          'tipo de contrato na origem.',
      );
      codigos.push('EMPRESA_EM_CLT');
    }
    empresaNome = null;
  } else if (tipoVinculo && !empresaNome) {
    erros.push('Prestador/terceirizado sem empresa contratante — informe a empresa.');
    codigos.push('EMPRESA_AUSENTE');
  }

  // ---- Datas ----------------------------------------------------------------
  const dataAdmissao = lerData(campo(pessoa, 'data_admissao'), 'admissão', erros, codigos);
  const dataNascimento = lerData(campo(pessoa, 'data_nascimento'), 'nascimento', erros, codigos);

  // ---- Contato --------------------------------------------------------------
  let email: string | null = campo(pessoa, 'email') || null;
  if (email && !emailValido(email)) {
    avisos.push(`E-mail "${email}" inválido — não foi importado.`);
    codigos.push('EMAIL_INVALIDO');
    email = null;
  }

  // ---- Endereço -------------------------------------------------------------
  const endereco = separarEndereco(campo(pessoa, 'endereco'), campo(pessoa, 'numero'));

  // ---- Dependentes ----------------------------------------------------------
  const dependentes = normalizarDependentes(registro.dependentes, avisos, codigos);

  return {
    numero,
    dados: {
      matricula: campo(pessoa, 'matricula') || null,
      nome,
      cpf,
      cargo,
      setor,
      tipoVinculo: tipoVinculo ?? TipoVinculo.CLT,
      empresaNome,
      dataAdmissao,
      dataNascimento,
      telefone: campo(pessoa, 'telefone') || null,
      email,
      ...endereco,
      bairro: campo(pessoa, 'bairro') || null,
      cidade: campo(pessoa, 'cidade') || null,
      uf: campo(pessoa, 'uf').toUpperCase().slice(0, 2) || null,
      cep: campo(pessoa, 'cep').replace(/\D/g, '') || null,
      status,
      statusMotivo,
      dependentes,
    },
    erros,
    avisos,
    codigos,
  };
}

function vazio(): ColaboradorLegado {
  return {
    matricula: null, nome: '', cpf: '', cargo: NAO_INFORMADO, setor: NAO_INFORMADO,
    tipoVinculo: TipoVinculo.CLT, empresaNome: null, dataAdmissao: null,
    dataNascimento: null, telefone: null, email: null, logradouro: null, numero: null,
    bairro: null, cidade: null, uf: null, cep: null,
    status: StatusColaborador.INATIVO, statusMotivo: null, dependentes: [],
  };
}

export function traduzirStatus(texto: string): {
  status: StatusColaborador;
  statusMotivo: string | null;
  desconhecido: boolean;
} {
  const chave = normalizarChave(texto);
  if (!chave) {
    // Coluna ausente é o caso do arquivo que só exporta gente da ativa. Assumir
    // ATIVO aqui é a leitura correta da origem, e não um chute sobre alguém.
    return { status: StatusColaborador.ATIVO, statusMotivo: null, desconhecido: false };
  }
  const status = STATUS_POR_TEXTO[chave];
  if (status) {
    return {
      status,
      // INATIVO e AFASTADO pedem motivo na tela de alteração de status; sem um
      // texto aqui, a ficha importada mostraria o status pelado e ninguém
      // saberia se foi decisão ou defeito da carga.
      statusMotivo:
        status === StatusColaborador.INATIVO || status === StatusColaborador.AFASTADO
          ? `Importado do sistema antigo com a situação "${texto}".`
          : null,
      desconhecido: false,
    };
  }
  /**
   * DESCONHECIDO FALHA FECHADO: entra como INATIVO, não como ATIVO.
   *
   * O status decide se a portaria libera a entrada. Chutar ATIVO num
   * "demitido em 2019" escrito de um jeito que este mapa não conhece dá crachá
   * de acesso ao clube para um ex-funcionário; chutar INATIVO no sentido
   * contrário faz alguém reclamar no balcão e a secretaria corrigir em um
   * clique. Os dois erros não têm o mesmo tamanho.
   */
  return {
    status: StatusColaborador.INATIVO,
    statusMotivo: `Situação "${texto}" não reconhecida na importação — confira a ficha.`,
    desconhecido: true,
  };
}

/**
 * "Rua Exemplo, 123" → logradouro + número.
 *
 * A origem traz o endereço numa linha só. Guardar tudo em `logradouro` faria a
 * etiqueta de correspondência e a ficha saírem com "Rua Exemplo, 123" no campo
 * da rua e o número vazio — e o número é o que o carteiro procura.
 *
 * Só separa quando o trecho depois da ÚLTIMA vírgula parece número (dígitos,
 * "123-A", "S/N"). "Rua Coronel Antônio, Bairro Centro" não é dividido.
 */
export function separarEndereco(
  enderecoCru: string,
  numeroCru: string,
): { logradouro: string | null; numero: string | null } {
  const numeroExplicito = numeroCru.trim();
  const endereco = enderecoCru.trim();
  if (!endereco) return { logradouro: null, numero: numeroExplicito || null };
  if (numeroExplicito) return { logradouro: endereco, numero: numeroExplicito };

  const virgula = endereco.lastIndexOf(',');
  if (virgula === -1) return { logradouro: endereco, numero: null };

  const cauda = endereco.slice(virgula + 1).trim();
  const ehNumero = /^(\d+[a-zA-Z]?(\s*-\s*[a-zA-Z0-9]+)?|s\/?n\.?|sn)$/i.test(cauda);
  if (!ehNumero) return { logradouro: endereco, numero: null };

  return { logradouro: endereco.slice(0, virgula).trim(), numero: cauda };
}

function normalizarDependentes(
  brutos: RegistroBruto[],
  avisos: string[],
  codigos: string[],
): DependenteLegado[] {
  const saida: DependenteLegado[] = [];
  let jaTemConjuge = false;

  for (const bruto of brutos) {
    const nome = campo(bruto, 'nome');
    const parentescoCru = campo(bruto, 'parentesco');
    const chave = normalizarChave(parentescoCru);
    const tipo = PARENTESCO_POR_TEXTO[chave] ?? PARENTESCO_APROXIMADO[chave];

    const descartar = (motivo: string) => {
      avisos.push(`Dependente "${nome || '(sem nome)'}" não importado: ${motivo}`);
      if (!codigos.includes('DEPENDENTE_DESCARTADO')) codigos.push('DEPENDENTE_DESCARTADO');
    };

    if (!nome) {
      descartar('sem nome.');
      continue;
    }
    if (!tipo) {
      descartar(
        `parentesco "${parentescoCru || '(vazio)'}" não tem equivalente no sistema ` +
          '(aceita cônjuge, filho(a), pai, mãe e enteado(a)). Cadastre à mão se for o caso.',
      );
      continue;
    }
    if (PARENTESCO_APROXIMADO[chave]) {
      avisos.push(
        `Dependente "${nome}" veio como "${parentescoCru}" e entrou como Filho(a) — ` +
          'é o equivalente mais próximo no sistema.',
      );
    }

    // `dependentes.data_nascimento` é NOT NULL, e é ela que decide se um filho
    // ainda pode entrar acompanhando (limite de 18). Sem data não há registro.
    const nascimento = parseData(campo(bruto, 'data_nascimento'));
    if (!nascimento || nascimento === 'INVALIDA') {
      descartar('data de nascimento ausente ou inválida.');
      continue;
    }

    if (tipo === TipoDependente.CONJUGE) {
      if (jaTemConjuge) {
        avisos.push(
          `Dependente "${nome}" não importado: já havia um cônjuge nesta linha ` +
            '(o sistema aceita um só).',
        );
        if (!codigos.includes('CONJUGE_DUPLICADO')) codigos.push('CONJUGE_DUPLICADO');
        continue;
      }
      jaTemConjuge = true;
    }

    const cpfDep = campo(bruto, 'cpf');
    saida.push({
      nome,
      // CPF de dependente é opcional no sistema e frequentemente é lixo na
      // origem (criança sem CPF vira 000.000.000-00). Inválido entra como nulo,
      // sem barrar ninguém: aqui ele não identifica, só ajuda a reencontrar.
      cpf: cpfValido(cpfDep) ? limparCpf(cpfDep) : null,
      tipo,
      dataNascimento: nascimento.toISOString().slice(0, 10),
    });
  }

  return saida;
}

function lerData(
  valor: string,
  rotulo: string,
  erros: string[],
  codigos: string[],
): string | null {
  const d = parseData(valor);
  if (d === 'INVALIDA') {
    erros.push(`Data de ${rotulo} inválida: "${valor}".`);
    if (!codigos.includes('DATA_INVALIDA')) codigos.push('DATA_INVALIDA');
    return null;
  }
  return d ? d.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Duplicidade DENTRO do arquivo
// ---------------------------------------------------------------------------

/**
 * Marca as linhas cujo CPF ou matrícula se repete no próprio arquivo.
 *
 * A PRIMEIRA OCORRÊNCIA PASSA; as seguintes viram erro. Deixar as duas passar
 * faria a segunda sobrescrever a primeira em silêncio — e o relatório diria
 * "2 importados" para uma pessoa só.
 */
export function marcarDuplicidadeNoArquivo(linhas: LinhaNormalizada[]): void {
  const cpfVisto = new Map<string, number>();
  const matriculaVista = new Map<string, number>();

  for (const linha of linhas) {
    const { cpf, matricula } = linha.dados;

    if (cpf) {
      const antes = cpfVisto.get(cpf);
      if (antes !== undefined) {
        linha.erros.push(`CPF repetido no arquivo (já apareceu na linha ${antes}).`);
        linha.codigos.push('CPF_DUP_ARQUIVO');
      } else {
        cpfVisto.set(cpf, linha.numero);
      }
    }

    if (matricula) {
      const chave = matricula.toUpperCase();
      const antes = matriculaVista.get(chave);
      if (antes !== undefined) {
        linha.erros.push(`Matrícula "${matricula}" repetida no arquivo (linha ${antes}).`);
        linha.codigos.push('MATRICULA_DUP_ARQUIVO');
      } else {
        matriculaVista.set(chave, linha.numero);
      }
    }
  }
}
