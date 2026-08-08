import { ModuloKey } from '../common/permissions/permissoes.constants';

/**
 * QUEM É O CLIENTE DESTA INSTALAÇÃO.
 *
 * Este arquivo é a única coisa que precisa mudar para o mesmo código servir a
 * outro sindicato. Tudo o que estava escrito à mão no meio da lógica — nome,
 * sigla, CNPJ, endereço, conta bancária, o vocabulário das telas — passa a sair
 * daqui.
 *
 * NÃO É MULTI-TENANT. Não existe seleção de cliente em tempo de execução: cada
 * instalação tem um cliente, um banco e um deploy. Se um dia forem dois
 * sindicatos, serão duas instalações — e esta é a razão de o arquivo ser um
 * módulo estático, e não uma tabela.
 *
 * O QUE MORA AQUI: identidade, dados institucionais que aparecem em documento
 * (PDF, termo, carnê) e a lista de módulos ligados.
 * O QUE NÃO MORA AQUI: segredo (fica em variável de ambiente) e dado que muda
 * sozinho (fica no banco).
 */

/**
 * Módulos que a instalação pode ligar ou desligar.
 *
 * É a MESMA lista da matriz de permissões (`ModuloKey`), e não uma paralela:
 * duas listas de módulos divergiriam na primeira vez que alguém acrescentasse
 * um dos lados. Carteirinha, dependentes e recadastramento não aparecem aqui
 * porque não são módulos — são partes do cadastro de filiados, e desligá-las
 * separadamente não faria sentido.
 */
export type ModuloSistema = ModuloKey;

export interface TenantConfig {
  /** Identificador técnico, em minúsculas — usado em log e em nome de arquivo. */
  id: string;
  sigla: string;
  /** Razão social completa, como sai em documento oficial. */
  nome: string;
  /** Versão curta para rodapé e assinatura. */
  nomeCurto: string;
  cnpj: string;
  /**
   * Registro sindical no Ministério do Trabalho. Sai no termo de filiação; nem
   * todo sindicato tem os dois números, por isso são opcionais.
   */
  registroSindical?: { processo?: string; codigoEntidade?: string };
  endereco: {
    logradouro: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
  };
  contato: { telefone?: string; email?: string; site?: string };
  /**
   * Conta para desconto em folha, citada no termo de filiação. Opcional porque
   * nem todo sindicato desconta em folha.
   */
  bancario?: { banco: string; agencia: string; operacao?: string; conta: string };
  /**
   * Como a instalação chama as pessoas que representa. "Filiado" no SENATEPI;
   * um sindicato de servidores pode preferir "servidor" ou "associado".
   */
  vocabulario: {
    filiado: string;
    filiados: string;
    /** Como se chama o número de identificação interno. */
    matricula: string;
  };
  /** Artigo do estatuto que fundamenta a contribuição (sai no termo). */
  contribuicao?: { artigoEstatuto?: string; descricao?: string };
  /**
   * Campos do cadastro que ESTA instalação não usa.
   *
   * O caso que motivou: `formacao` é a escala de enfermagem (enfermeiro,
   * técnico, auxiliar) e não significa nada num sindicato de servidores
   * municipais, onde o que vale é o cargo — que já é texto livre no vínculo
   * profissional.
   *
   * ESCONDER, E NÃO APAGAR: o campo continua no banco e no histórico do
   * SENATEPI. Remover a coluna para agradar um cliente destruiria o dado do
   * outro. Um campo oculto simplesmente não é pedido nem exibido.
   */
  camposOcultos?: string[];
  modulos: ModuloSistema[];
}

export const tenant: TenantConfig = {
  id: 'senatepi',
  sigla: 'SENATEPI',
  nome: 'SINDICATO DOS ENFERMEIROS, AUXILIARES E TÉCNICOS EM ENFERMAGEM DO ESTADO DO PIAUÍ',
  nomeCurto: 'Sindicato dos Enfermeiros do Piauí',
  cnpj: '11.378.331/0001-86',
  registroSindical: {
    processo: '46214.0005793/2018-86',
    codigoEntidade: '19020-7',
  },
  endereco: {
    logradouro: 'RUA LUCÍDIO FREITAS, Nº 1070',
    bairro: 'CENTRO-NORTE',
    cidade: 'TERESINA',
    uf: 'PI',
    cep: '64000-440',
  },
  contato: {},
  bancario: { banco: 'CEF', agencia: '2004', operacao: '003', conta: '1341-4' },
  vocabulario: { filiado: 'filiado', filiados: 'filiados', matricula: 'matrícula' },
  contribuicao: {
    artigoEstatuto: 'Art. 57, §1º',
    descricao: '1% sobre o maior vencimento básico ao qual esteja vinculado',
  },
  // O SENATEPI usa todos os campos do cadastro.
  camposOcultos: [],
  // Todos ligados: é a instalação de referência.
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'colonia', 'cobrancas',
    'empresas', 'auditoria', 'usuarios',
  ],
};

/** Endereço em uma linha — é como ele aparece no rodapé dos PDFs. */
export function enderecoEmLinha(t: TenantConfig = tenant): string {
  const { logradouro, bairro, cidade, uf, cep } = t.endereco;
  return `${logradouro}, ${bairro}, ${cidade}-${uf}, CEP: ${cep}`;
}

/** Conta bancária no formato usado no termo de filiação. */
export function contaEmLinha(t: TenantConfig = tenant): string {
  if (!t.bancario) return '';
  const { banco, agencia, operacao, conta } = t.bancario;
  const op = operacao ? `OP: ${operacao}; ` : '';
  return `AG: ${agencia}; ${op}C/C ${conta} BANCO: ${banco}`;
}

/** O módulo está ligado nesta instalação? */
export function moduloAtivo(modulo: ModuloSistema, t: TenantConfig = tenant): boolean {
  return t.modulos.includes(modulo);
}
