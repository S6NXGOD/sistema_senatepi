import { ModuloKey } from '../common/permissions/permissoes.constants';

/**
 * O CONTRATO DE UM CLIENTE — o formato da "forma de bolo".
 *
 * Separado das configurações em si porque é o que os dois lados olham: cada
 * sindicato em `tenants/` preenche esta interface, e o resto do sistema só
 * conhece a interface. Acrescentar um campo aqui obriga (pelo compilador) todos
 * os clientes a responderem — que é exatamente o que se quer num monorepo com
 * mais de um sindicato.
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
  /** Identificador técnico, em minúsculas — é o valor de `TENANT` no ambiente. */
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
