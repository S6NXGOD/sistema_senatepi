import { TenantConfig } from '../tenant.types';

/**
 * SINDSERM — Sindicato dos Servidores Públicos Municipais de Teresina.
 * Cliente nº 2. Banco próprio, serviço próprio, MESMO código.
 *
 * O QUE MUDA EM RELAÇÃO AO SENATEPI, e por quê:
 *
 * · `colonia` desligada — a colônia de férias é do SENATEPI, com regra de
 *   reserva e sorteio próprias do sindicato. Não faz sentido oferecer.
 * · `acessos` LIGADA — é o oposto: o SINDSERM tem clube, e a entrada se dá pela
 *   carteirinha com QR, pela matrícula ou pelo CPF. É a razão de a portaria
 *   existir.
 * · `formacao` oculto — é a escala de enfermagem (enfermeiro, técnico,
 *   auxiliar). Num sindicato de servidores o que vale é o cargo, que já é texto
 *   livre no vínculo profissional.
 *
 * ITENS MARCADOS COM «confirmar» estão preenchidos com a melhor leitura do que
 * foi dito até aqui, não com informação do próprio sindicato. Estão isolados
 * neste arquivo justamente para serem revistos numa passada só, antes do
 * primeiro deploy.
 */
export const sindserm: TenantConfig = {
  id: 'sindserm',
  sigla: 'SINDSERM',
  nome: 'SINDICATO DOS SERVIDORES PÚBLICOS MUNICIPAIS DE TERESINA',
  nomeCurto: 'Sindicato dos Servidores Municipais de Teresina',
  cnpj: '', // confirmar
  registroSindical: {}, // confirmar
  endereco: {
    logradouro: '', // confirmar
    bairro: '',
    cidade: 'TERESINA',
    uf: 'PI',
    cep: '',
  },
  contato: {},
  /**
   * Sem conta bancária: a contribuição do SINDSERM é SOMENTE desconto em folha
   * da Prefeitura. Deixar em branco é a informação correta, não uma pendência —
   * o termo de filiação simplesmente não imprime a linha da conta.
   */
  vocabulario: {
    // «servidor» em vez de «filiado»: é como a categoria se chama a si mesma, e
    // o vocabulário existe exatamente para isso.
    filiado: 'servidor',
    filiados: 'servidores',
    // A matrícula que o servidor sabe de cor é a da Prefeitura.
    matricula: 'matrícula',
  },
  contribuicao: {
    descricao: 'Desconto em folha de pagamento da Prefeitura Municipal de Teresina', // confirmar percentual
  },
  /**
   * `formacao` é a escala de enfermagem (enfermeiro, técnico, auxiliar) e
   * `numeroCoren` é o registro no conselho de enfermagem. Nenhum dos dois
   * significa coisa alguma para um servidor municipal — e os dois eram
   * OBRIGATÓRIOS no formulário, então esconder um sem o outro deixava o
   * cadastro impossível de enviar.
   *
   * Ambos continuam no banco e no histórico do SENATEPI. Aqui apenas não são
   * pedidos nem exibidos.
   */
  camposOcultos: ['formacao', 'numeroCoren'],
  /**
   * `colonia` fora (não existe aqui) e `acessos` dentro (o clube é a razão de
   * ser da portaria).
   *
   * `cobrancas` e `empresas` ficam DESLIGADAS — confirmado pelo sindicato:
   * cobrança é boleto/PIX/carnê, e aqui a contribuição é só desconto em folha
   * da Prefeitura; «empresas (patronal)» pressupõe muitos empregadores
   * privados, e aqui o empregador é um só.
   *
   * `escalas` fica LIGADA: apesar do nome, é a escala dos ADVOGADOS, não escala
   * de plantão de enfermagem — serve a qualquer sindicato com jurídico.
   */
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'acessos', 'auditoria', 'usuarios',
  ],
};
