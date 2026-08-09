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
  /**
   * Estes números e o e-mail estavam escritos à mão dentro de três geradores de
   * PDF. O rodapé continua saindo idêntico — só que agora de um lugar só, e o
   * documento de outro sindicato não manda mais ligar para o SENATEPI.
   */
  contato: {
    telefone: '(86) 3303-1426; (86) 99421-1117',
    email: 'senatepienfermagem@outlook.com',
  },
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
  //
  // `organizacoes` também fica de fora, e por um motivo mais forte: o SENATEPI
  // TEM o módulo patronal (`empresas`), e as duas telas colidem. São tabelas
  // diferentes — `empresas` é quem faz repasse e tem login no portal;
  // `partes_externas` é quem emprega o filiado e figura como parte no processo
  // — mas com nomes sinônimos e o mesmo ícone, lado a lado no menu. Pior: o
  // hospital que é as três coisas teria de ser cadastrado duas vezes, sem
  // ligação entre os registros.
  //
  // Isto NÃO tira nada do que o SENATEPI tem hoje: a tela nunca existiu aqui,
  // e `partes_externas` segue sendo alimentada de dentro das telas de processo
  // e de vínculo profissional, exatamente como sempre foi. Quando os dois
  // cadastros forem unificados (uma organização, com o dossiê patronal
  // pendurado nela), esta linha volta — aí como cadastro único.
  // As duas fontes do jurídico.
  integracoes: ['datajud', 'djen'],
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'colonia', 'cobrancas',
    'empresas', 'auditoria', 'usuarios',
  ],
};
