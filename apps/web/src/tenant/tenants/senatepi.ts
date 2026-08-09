import type { PaletaMarca, TenantConfigWeb } from '../tenant.types';

/**
 * Paleta institucional do SENATEPI — ESCALA COMPLETA.
 *
 * Faltavam 100, 200, 300, 500 e 700. Como o Tailwind não emite classe para tom
 * inexistente, `bg-brand-700 text-white` virava texto branco sobre fundo
 * branco. O 700 foi escolhido escuro o bastante para passar em contraste AA
 * (4.6:1) com texto branco — o caso das abas e dos botões primários.
 */
const PALETA_SENATEPI: PaletaMarca = {
  900: '#145E07',
  800: '#1B7F0A', // Verde escuro (institucional)
  700: '#2C860F',
  600: '#4FA11B', // Verde médio
  500: '#75B32C',
  400: '#9BC53D', // Verde claro
  300: '#B5D268',
  200: '#D0E29E',
  100: '#E4F0CC',
  50: '#F1F8E9',
};

/** SENATEPI — Sindicato dos Enfermeiros do Piauí. Cliente nº 1, em produção. */
export const senatepi: TenantConfigWeb = {
  id: 'senatepi',
  sigla: 'SENATEPI',
  nome: 'SINDICATO DOS ENFERMEIROS, AUXILIARES E TÉCNICOS EM ENFERMAGEM DO ESTADO DO PIAUÍ',
  descricao: 'Sindicato dos Enfermeiros do Piauí',
  paleta: PALETA_SENATEPI,
  vocabulario: { filiado: 'filiado', filiados: 'filiados', matricula: 'matrícula' },
  // `acessos` (portaria do clube) fica de fora: a colônia do SENATEPI tem
  // controle próprio, com regra de reserva e sorteio. A portaria nasceu para
  // o clube do SINDSERM e ligá-la aqui só somaria um menu sem uso.
  //
  // `organizacoes` fica de fora porque COLIDE com `empresas`, que o SENATEPI
  // tem: dois cadastros de organização, em tabelas diferentes, com nomes
  // sinônimos e o mesmo ícone no menu. Nada se perde — a tela nunca existiu
  // aqui e `partes_externas` segue alimentada de dentro de processos e
  // vínculos. Ver a nota completa no arquivo equivalente da API.
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'colonia', 'cobrancas',
    'empresas', 'auditoria', 'usuarios',
  ],
  // O SENATEPI usa todos os campos do cadastro.
  camposOcultos: [],
  /**
   * Categoria fechada: os três cargos da enfermagem, com escape para o caso
   * atípico (enfermeiro em função administrativa). É esta lista que permite
   * contar quantos técnicos há em cada empregador.
   */
  cargos: ['Enfermeiro(a)', 'Técnico(a) em Enfermagem', 'Auxiliar de Enfermagem'],
};
