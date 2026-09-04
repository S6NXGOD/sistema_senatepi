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
  vocabulario: {
    filiado: 'filiado',
    filiados: 'filiados',
    matricula: 'matrícula',
    // Hospitais e clínicas — cada empregador é uma pessoa jurídica distinta.
    empregador: 'Instituição / Empresa',
    lotacaoDica: 'Setor, unidade ou ala',
  },
  contribuicao: {
    artigoEstatuto: 'Art. 57, §1º',
    descricao: '1% sobre o maior vencimento básico ao qual esteja vinculado',
  },
  // O SENATEPI usa todos os campos do cadastro.
  camposOcultos: [],
  /**
   * Os empregadores da enfermagem semeados pela migration de locais de
   * trabalho. AQUI eles são legítimos — é onde os filiados trabalham, e é o que
   * faz o combobox de empregador nascer útil.
   *
   * Estão declarados para que `OrganizacoesHerdadasService` saiba que NÃO deve
   * removê-los desta instalação. Em qualquer outro cliente, a mesma lista é
   * lixo herdado de uma migration que não sabia de quem era o banco.
   */
  empregadoresIniciais: [
    'FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA',
    'SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ',
    'HOSPITAL UNIVERSITÁRIO DA UFPI',
    'MATERNIDADE DONA EVANGELINA ROSA',
    'HOSPITAL GETÚLIO VARGAS',
    'HOSPITAL DE URGÊNCIA DE TERESINA',
    'INSTITUTO DE DOENÇAS TROPICAIS NATAN PORTELLA',
    'PRONTOCARE',
  ],
  // `acessos` (portaria do clube) fica de fora: a colônia do SENATEPI tem
  // controle próprio, com regra de reserva e sorteio. A portaria nasceu para
  // o clube do SINDSERM e ligá-la aqui só somaria um menu sem uso.
  //
  // `organizacoes` ESTAVA de fora enquanto colidia com `empresas`: eram dois
  // cadastros de organização, em tabelas que não se conheciam, com nomes
  // sinônimos no menu — e o hospital que emprega, é réu e faz repasse tinha de
  // ser cadastrado duas vezes. A unificação acabou com isso: `partes_externas`
  // virou O cadastro, e `empresas` virou o dossiê patronal pendurado nele. Os
  // dois itens de menu deixaram de ser redundantes — um é o CADASTRO de
  // qualquer organização, o outro é o TRABALHO patronal sobre as que
  // contribuem. Por isso a linha voltou.
  // As duas fontes do jurídico.
  integracoes: ['datajud', 'djen'],
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'colonia', 'cobrancas',
    'empresas', 'organizacoes', 'relatorios', 'auditoria', 'usuarios',
  ],
};
