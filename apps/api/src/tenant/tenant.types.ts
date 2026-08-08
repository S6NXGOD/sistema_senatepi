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

/**
 * INTEGRAÇÕES EXTERNAS que uma instalação pode ligar.
 *
 * Diferente de `ModuloSistema`: módulo é uma ÁREA do sistema (o jurídico
 * existe ou não existe); integração é uma FONTE DE DADOS dentro de uma área
 * que existe. Dois sindicatos podem ter o jurídico e só um consultar o DJEN —
 * é o caso real hoje, porque a consulta depende de o IP do servidor ser aceito
 * pelo CNJ.
 *
 * É AQUI que entra a fonte de dados de um cliente futuro. O código dela vive no
 * módulo compartilhado, como o DJEN vive dentro de `processos`; o que muda por
 * cliente é esta lista.
 */
export type IntegracaoExterna =
  /**
   * Consulta processual do CNJ. Desligada, o acervo continua existindo e sendo
   * editado à mão — some a varredura automática e o botão de sincronizar.
   */
  | 'datajud'
  /**
   * Publicações e intimações do Diário de Justiça Eletrônico Nacional.
   *
   * Depende de o IP do servidor ser aceito pelo CNJ, o que é por instalação e
   * não por código — a razão de isto ser uma chave por cliente.
   */
  | 'djen';

/**
 * SÓ ENTRA AQUI O QUE É REALMENTE CONFERIDO em algum lugar do código.
 *
 * `brasilapi` chegou a ser declarada e foi removida antes de virar hábito:
 * ninguém lia a chave, então ela seria uma promessa sem efeito — o mesmo
 * defeito de `vocabulario`, que existia desde a Fase 0 e não mudava uma
 * palavra na tela. Flag que não é lida é pior que flag ausente, porque
 * quem lê o arquivo acredita nela.
 */

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
  /**
   * Fontes externas ligadas nesta instalação.
   *
   * Estava só em variável de ambiente (`DJEN_INTEGRACAO`), o que funcionava —
   * cada cliente tem o seu serviço — mas era invisível: não dava para olhar o
   * arquivo do sindicato e saber o que ele consulta. Aqui é declaração; a
   * variável de ambiente continua valendo como interruptor de emergência,
   * para desligar sem deploy quando uma API externa cai.
   */
  integracoes?: IntegracaoExterna[];
}
