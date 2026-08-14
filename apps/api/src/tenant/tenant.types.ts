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
   * DESTINADA A SER PADRÃO EM TODOS OS CLIENTES. Está desligada hoje por um
   * motivo de hospedagem, não de sindicato: o CDN do CNJ recusa a consulta que
   * não chega por um ponto de presença no Brasil, e o servidor atual está nos
   * Estados Unidos — medido lado a lado, mesma URL, 200 do Brasil e 403 de lá.
   *
   * A chave continua existindo depois da mudança de hospedagem: é ela que
   * permite desligar um cliente sozinho quando o CNJ estiver fora do ar, sem
   * derrubar a consulta dos outros.
   */
  | 'djen';

/**
 * MIGRAÇÕES DE SISTEMA ANTIGO que esta instalação tem à disposição.
 *
 * Diferente de `ModuloSistema` e de `IntegracaoExterna`: módulo é uma ÁREA do
 * sistema, integração é uma fonte de dados PERMANENTE, e um importador destes é
 * uma porta TEMPORÁRIA para o formato de um sistema que o cliente está deixando
 * para trás. Ele nasce ligado, é usado três ou quatro vezes até o arquivo da
 * origem sair certo, e depois sai da lista — sem apagar código, porque o
 * próximo cliente a migrar de um sistema parecido vai querer o mesmo caminho.
 *
 * POR QUE NÃO BASTA O MÓDULO. `colaboradores` está ligado nos dois clientes: o
 * cadastro da equipe é de todo sindicato. O que é de UM cliente é a migração —
 * e uma tela de "importar equipe" no menu de quem não tem o que importar é um
 * botão que só serve para alguém clicar por engano com o arquivo errado.
 *
 * A folha da Prefeitura NÃO está aqui, e a ausência é deliberada: ela não é
 * migração, é a planilha que a Prefeitura manda TODO MÊS, e o layout dela se
 * reconhece sozinho pelos cabeçalhos.
 */
export type ImportadorLegado =
  /**
   * Equipe do sindicato (funcionários, prestadores e dependentes) exportada em
   * JSON/CSV pelo sistema anterior do SINDSERM. Cria `Colaborador`, nunca
   * `Filiado`.
   */
  'colaboradores-legado';

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
    /**
     * Rótulo do EMPREGADOR no vínculo profissional.
     *
     * No SENATEPI é «Instituição / Empresa» — hospitais e clínicas, cada um uma
     * pessoa jurídica diferente. No SINDSERM o empregador é SEMPRE a Prefeitura
     * de Teresina, e o que varia é o ÓRGÃO (SEMEC, FMS, STRANS…). Chamar de
     * "empresa" o órgão público faz a secretaria hesitar no preenchimento.
     */
    empregador: string;
    /**
     * Dica da LOTAÇÃO — o lugar de trabalho DENTRO do empregador.
     *
     * No SINDSERM a lotação é a escola, o CMEI, o hospital: é o local onde a
     * pessoa efetivamente trabalha, e é por ele que a base se organiza. No
     * SENATEPI é o setor dentro do hospital.
     */
    lotacaoDica: string;
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
  /**
   * Campos que ESTA instalação torna OBRIGATÓRIOS, além do que o core já exige.
   *
   * O par de `camposOcultos`: um tira da tela o que não se usa, o outro exige o
   * que é essencial AQUI e não é em toda parte. Chave no formato
   * `entidade.campo` (ex.: `vinculo.matricula`).
   *
   * O caso que motivou: no SINDSERM a matrícula da Prefeitura é única no
   * município e é a âncora da importação da folha, que não traz CPF — vínculo
   * sem matrícula vira cadastro duplicado na competência seguinte. No SENATEPI
   * é o oposto: hospitais reaproveitam numeração, a âncora é o CPF, e exigir
   * matrícula barraria cadastro legítimo.
   */
  camposObrigatorios?: string[];
  /**
   * EMPREGADORES QUE ESTA INSTALAÇÃO RECONHECE como sua — pelo nome, em
   * maiúsculas, exatamente como estão em `partes_externas.nome`.
   *
   * POR QUE ISTO EXISTE. A migration `20260802120000_locais_trabalho_e_modalidade`
   * semeia oito empregadores da ENFERMAGEM (HGV, HUT, PRONTOCARE, Maternidade
   * Evangelina Rosa…) para o combobox do SENATEPI já nascer útil. Migration não
   * sabe de qual cliente é o banco — então TODO cliente novo nasce com os
   * hospitais do SENATEPI dentro. Aconteceu com o SINDSERM, um sindicato de
   * servidores municipais que não tem nada com hospital estadual, e aconteceria
   * de novo com o terceiro cliente.
   *
   * A migration já rodou em produção e não pode ser reescrita. Quem passa a
   * mandar é esta lista, lida por `OrganizacoesHerdadasService` no boot: o que
   * a instalação NÃO reconhece e NINGUÉM usa é removido.
   *
   * Lista vazia (ou ausente) significa "não reconheço nenhum destes" — que é o
   * caso de todo cliente que não seja o SENATEPI.
   */
  empregadoresIniciais?: string[];
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
  /**
   * Migrações de sistema antigo disponíveis nesta instalação. Ausente ou vazia
   * significa "não há nada a migrar aqui" — que é o estado final de todo
   * cliente depois que a carga terminou.
   */
  importadores?: ImportadorLegado[];
}
