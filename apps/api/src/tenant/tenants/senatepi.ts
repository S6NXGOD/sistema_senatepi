import { TenantConfig } from '../tenant.types';

/** SENATEPI — Sindicato dos Enfermeiros do Piauí. Cliente nº 1, em produção. */
export const senatepi: TenantConfig = {
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
  // `acessos` (portaria do clube) fica de fora: a colônia do SENATEPI tem
  // controle próprio, com regra de reserva e sorteio. A portaria nasceu para
  // o clube do SINDSERM e ligá-la aqui só somaria um menu sem uso.
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'colonia', 'cobrancas',
    'empresas', 'auditoria', 'usuarios',
  ],
};
