import type { PaletaMarca, TenantConfigWeb } from '../tenant.types';

/**
 * Paleta do SINDSERM — PROVISÓRIA. «confirmar»
 *
 * As cores institucionais do sindicato ainda não foram informadas. Esta escala
 * azul está aqui para o sistema ficar visivelmente DIFERENTE do SENATEPI desde
 * o primeiro dia — se as duas instalações abrissem verdes iguais, a chance de
 * alguém operar no cliente errado sem perceber seria real.
 *
 * Trocar a identidade visual inteira é editar os dez tons abaixo. Os mesmos
 * cuidados da paleta do SENATEPI valem aqui: a escala precisa ter os dez
 * degraus (o Tailwind não emite classe para tom inexistente) e o 700 precisa
 * passar em contraste AA com texto branco, porque é o tom dos botões primários
 * e das abas.
 */
const PALETA_SINDSERM: PaletaMarca = {
  900: '#0B3B66',
  800: '#0F4C81', // Azul escuro (institucional)
  700: '#155E9C',
  600: '#1D74BD', // Azul médio
  500: '#3A8FD0',
  400: '#63A9DC', // Azul claro
  300: '#93C4E8',
  200: '#BFDBF0',
  100: '#DDEBF8',
  50: '#F0F7FC',
};

/**
 * SINDSERM — Sindicato dos Servidores Públicos Municipais de Teresina.
 * Cliente nº 2. Mesmo código, banco próprio, build próprio.
 *
 * A lista de módulos precisa bater com a de
 * `apps/api/src/tenant/tenants/sindserm.ts` — lá está o porquê de cada
 * ausência. Menu visível com rota morta leva a pessoa a um erro; menu escondido
 * com rota viva deixa a funcionalidade acessível por URL.
 */
export const sindserm: TenantConfigWeb = {
  id: 'sindserm',
  sigla: 'SINDSERM',
  nome: 'SINDICATO DOS SERVIDORES PÚBLICOS MUNICIPAIS DE TERESINA',
  descricao: 'Sindicato dos Servidores Municipais de Teresina',
  paleta: PALETA_SINDSERM,
  // «filiado», e não «servidor»: nem todo servidor da Prefeitura é filiado ao
  // sindicato, e é o filiado que este cadastro guarda. Ver o arquivo da API.
  vocabulario: {
    filiado: 'filiado',
    filiados: 'filiados',
    matricula: 'matrícula',
    // O empregador é SEMPRE a Prefeitura de Teresina; o que varia é o ÓRGÃO
    // (SEMEC, FMS, STRANS…), e ele sai da lista mantida em Organizações.
    // Chamar de «empresa» um órgão público faz a secretaria hesitar.
    empregador: 'Órgão',
    // A lotação AQUI é o local de trabalho de verdade: a escola, o CMEI, o
    // hospital. É por ela que a base se organiza.
    lotacaoDica: 'Escola, CMEI, hospital, unidade…',
  },
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'acessos',
    // `organizacoes` NÃO entra, e isto é uma decisão do sindicato, não uma
    // limitação: o SINDSERM é dedicado à Prefeitura de Teresina. O empregador é
    // sempre ela; o que varia é o ÓRGÃO — uma lista de ~36 secretarias que muda
    // uma vez por reforma administrativa — e depois a LOTAÇÃO, que é texto
    // livre (a escola, o CMEI, a unidade de saúde).
    //
    // Uma tela de CRUD genérica é a ferramenta errada para 36 linhas quase
    // fixas: ela pede manutenção que ninguém faz e expõe `partes_externas`
    // inteira, que também guarda réu de processo. O sistema antigo do sindicato
    // não tinha esse cadastro e a operação funcionava.
    //
    // Os 36 órgãos entram pela carga própria (`npm run seed:orgaos:sindserm`) e
    // são escolhidos no combobox do vínculo. Consequência aceita: réus de
    // processo acumulam em `partes_externas` sem tela para administrá-los —
    // exatamente como era no SENATEPI antes desta tela existir.
    'relatorios', 'auditoria', 'usuarios',
  ],
  // Escala de enfermagem e registro no conselho de enfermagem. Precisam sair
  // JUNTOS: os dois eram obrigatórios no formulário, e esconder um sem o outro
  // deixaria o cadastro impossível de enviar. Ver o mesmo campo na API.
  camposOcultos: ['formacao', 'numeroCoren'],
  // A matrícula da Prefeitura é única no município e é a ÂNCORA da importação
  // da folha, que não traz CPF. Vínculo sem ela não reencontra o servidor na
  // competência seguinte e vira cadastro duplicado.
  camposObrigatorios: ['vinculo.matricula'],
  /**
   * SEM lista fechada: o cargo aqui é texto livre.
   *
   * O plano de cargos do município tem centenas de carreiras — professor,
   * agente de trânsito, fiscal, médico, auxiliar administrativo —, e um select
   * com todas seria impossível de manter e estaria errado no dia seguinte a uma
   * reestruturação. O campo do sistema antigo era «Cargo/Carreira/
   * Especialidade», digitado, e essa é a decisão certa.
   */
  cargos: [],
  /**
   * MIGRAÇÃO EM ANDAMENTO — equipe (funcionários, prestadores e dependentes) do
   * sistema anterior. Espelha a mesma linha em
   * `apps/api/src/tenant/tenants/sindserm.ts`, onde está o porquê.
   *
   * APAGUE AS DUAS quando a carga terminar: o botão some de Colaboradores e a
   * rota volta a responder 404.
   */
  importadores: ['colaboradores-legado'],
};
