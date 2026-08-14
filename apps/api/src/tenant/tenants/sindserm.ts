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
  // A matrícula da Prefeitura é única no município e é a ÂNCORA da importação
  // da folha, que não traz CPF. Vínculo sem ela não reencontra o servidor na
  // competência seguinte e vira cadastro duplicado.
  camposObrigatorios: ['vinculo.matricula'],
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
  /**
   * MIGRAÇÃO EM ANDAMENTO — a equipe do sindicato (funcionários, prestadores e
   * dependentes) vem do sistema anterior num JSON/CSV.
   *
   * É TEMPORÁRIO DE PROPÓSITO: quando a carga terminar e for conferida, apague
   * esta linha. A tela some do menu, a rota volta a responder 404 e o código
   * continua onde está, para o terceiro cliente que migrar de um sistema
   * parecido. Importador que fica ligado para sempre é um botão esperando ser
   * clicado com o arquivo errado.
   *
   * NÃO VALE PARA O SENATEPI: a equipe dele já está cadastrada, e a chave
   * ausente lá é a resposta certa, não um esquecimento.
   */
  importadores: ['colaboradores-legado'],
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
    'auditoria', 'usuarios',
  ],
};
