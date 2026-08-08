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
  vocabulario: { filiado: 'filiado', filiados: 'filiados', matricula: 'matrícula' },
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'acessos', 'auditoria', 'usuarios',
  ],
  // Escala de enfermagem e registro no conselho de enfermagem. Precisam sair
  // JUNTOS: os dois eram obrigatórios no formulário, e esconder um sem o outro
  // deixaria o cadastro impossível de enviar. Ver o mesmo campo na API.
  camposOcultos: ['formacao', 'numeroCoren'],
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
};
