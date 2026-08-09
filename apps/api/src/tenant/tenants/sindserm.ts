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
 * DADOS INSTITUCIONAIS confirmados pelo sindicato em 08/08/2026. O que ainda
 * não veio dele é a PALETA — a cor de hoje é provisória (ver o arquivo do web),
 * e agora pode ser trocada pela própria tela, em Configurações → Identidade
 * visual, sem passar por aqui.
 */
export const sindserm: TenantConfig = {
  id: 'sindserm',
  sigla: 'SINDSERM',
  nome: 'SINDICATO DOS SERVIDORES PÚBLICOS MUNICIPAIS DE TERESINA',
  nomeCurto: 'Sindicato dos Servidores Municipais de Teresina',
  cnpj: '23.649.007/0001-34',
  registroSindical: { codigoEntidade: '000.000.000.26085-1' },
  endereco: {
    logradouro: 'RUA QUINTINO BOCAIÚVA, Nº 446',
    bairro: 'CENTRO (NORTE)',
    cidade: 'TERESINA',
    uf: 'PI',
    cep: '64001-270',
  },
  contato: {},
  /**
   * Sem conta bancária: a contribuição do SINDSERM é SOMENTE desconto em folha
   * da Prefeitura. Deixar em branco é a informação correta, não uma pendência —
   * o termo de filiação simplesmente não imprime a linha da conta.
   */
  /**
   * «filiado», e não «servidor».
   *
   * Parece igual e não é: servidor é quem trabalha na Prefeitura; filiado é
   * quem se associou ao sindicato. Nem todo servidor é filiado, e o sistema
   * cadastra os filiados. Chamar a tela de «Servidores» daria a entender que
   * ali está a folha inteira do município.
   *
   * A matrícula que o filiado sabe de cor é a da Prefeitura.
   */
  vocabulario: { filiado: 'filiado', filiados: 'filiados', matricula: 'matrícula' },
  contribuicao: {
    descricao:
      '1% sobre o vencimento base, descontado em folha de pagamento da ' +
      'Prefeitura Municipal de Teresina',
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
  /**
   * Só o DataJud por enquanto.
   *
   * `djen` fica de fora POR ORA, e não por característica do sindicato: o CDN
   * do CNJ recusa consultas que não chegam por um ponto de presença no Brasil,
   * e o servidor de hoje está nos Estados Unidos. Assim que a hospedagem
   * mudar para o Brasil, `djen` passa a ser padrão em todos os clientes — é
   * acrescentar a palavra nesta lista.
   */
  integracoes: ['datajud'],
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'acessos',
    // A tela de órgãos. Aqui ela não tem com o que colidir: sem o módulo
    // patronal, "Organizações" é o único cadastro de organização que existe.
    'organizacoes',
    'auditoria', 'usuarios',
  ],
};
