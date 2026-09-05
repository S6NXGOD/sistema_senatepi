import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  A LEITURA NORMALIZA A QUEBRA DE LINHA.

  No Windows o git entrega os arquivos com CRLF, e uma asserção que cita duas
  linhas com uma quebra deixa de casar — reprovando a formatação em vez da
  regra. Aconteceu com o teste do `AlertBar` depois de uma edição que nem
  tocou nele.
*/
const ler = (rel: string) =>
  readFileSync(resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const PAINEL = ler('app/(dashboard)/dashboard/page.tsx');
const AGENDA = ler('app/(dashboard)/agenda/page.tsx');
const CARTAO = ler('components/agenda/compromisso-card.tsx');
const ERRO_PAINEL = ler('app/(dashboard)/error.tsx');
const ERRO_GLOBAL = ler('app/global-error.tsx');

/**
 * O PAINEL DO BALCÃO — a Triagem é quem recadastra, e a home tem de servir a
 * ela tanto quanto ao jurídico.
 */
describe('a fila do balcão', () => {
  /**
   * SEM TELEFONE ERA BECO SEM SAÍDA, e é o caso mais comum: 7.137 dos 7.291
   * filiados não têm telefone. O card dizia "sem telefone" e acabava ali — não
   * dava para parabenizar nem para consertar.
   */
  it('o aniversário sem telefone vira convite a completar o cadastro', () => {
    expect(PAINEL).toContain('Completar cadastro');
    expect(PAINEL).toContain('onCompletar?.(p.id)');
    expect(PAINEL).toContain('podeCompletar && p.tipo === ');
  });

  /**
   * A LISTA É UMA AMOSTRA e a tela diz isso: só 499 dos 7.291 filiados têm data
   * de nascimento. Sem a ressalva, quem parabeniza dois hoje conclui que
   * parabenizou todo mundo.
   */
  it('avisa que só aparece quem tem data de nascimento', () => {
    expect(PAINEL).toContain('Só aparece quem tem data de nascimento no cadastro.');
  });

  /**
   * A FILA NÃO É A DÍVIDA INTEIRA. Sete mil fichas incompletas não são fila de
   * trabalho; o recorte é quem teve atendimento recente ou tem processo.
   */
  it('a fila de cadastros diz qual é o recorte', () => {
    expect(PAINEL).toContain('function CadastrosACompletar(');
    expect(PAINEL).toContain('Só quem teve atendimento recente ou tem processo');
  });

  /** Quem não grava filiado não recebe uma fila que não pode resolver. */
  it('a fila só aparece para quem edita filiado', () => {
    expect(PAINEL).toContain("podeEditar(role, user?.permissoes, 'filiados')");
    expect(PAINEL).toContain('{podeEditarFiliado && (');
  });

  /** O emoji de bolo saiu: ícone, como no resto do sistema. */
  it('não usa emoji no lugar de ícone', () => {
    const bloco = PAINEL.slice(PAINEL.indexOf('function Aniversariantes('));
    expect(bloco.slice(0, 3000)).toContain('<Cake className=');
    expect(bloco.slice(0, 3000)).not.toContain('🎂');
  });
});

/**
 * AS FONTES EXTERNAS PARARAM? — a pergunta que o painel não sabia responder.
 *
 * Havia "a varredura rodou?" e "chegou publicação?". Nenhum dos dois dizia se a
 * integração QUEBROU, e a diferença custou semanas: quando a ponte do DJEN
 * caiu, a home mostrou "silenciosa", que se lê como semana parada.
 */
describe('saúde das integrações', () => {
  it('existe e sai do log de chamadas', () => {
    expect(PAINEL).toContain('function SaudeDasIntegracoes(');
    expect(PAINEL).toContain('data.integracoes');
  });

  /** Selo verde permanente vira paisagem — e some junto o dia em que fica vermelho. */
  it('não mostra nada quando está tudo bem', () => {
    const bloco = PAINEL.slice(PAINEL.indexOf('function SaudeDasIntegracoes('));
    expect(bloco.slice(0, 1200)).toContain("i.situacao === 'PARADA' || i.situacao === 'INSTAVEL'");
    expect(bloco.slice(0, 1200)).toContain('if (problemas.length === 0) return null;');
  });

  /**
   * O AVISO NÃO TEM DESTINO, e é legítimo: não é trabalho de ninguém dentro do
   * sistema. Um link para lugar nenhum seria pior que link nenhum.
   */
  it('o alerta aceita existir sem link', () => {
    expect(PAINEL).toContain('href?: string;');
    expect(PAINEL).toContain('  ) : (\n    <div className={classe}>{corpo}</div>');
  });
});

/**
 * CHEGAR NUMA ATIVIDADE VINDO DE FORA — o atalho abria a gaveta e deixava o
 * fundo errado.
 *
 * Clicando numa publicação do painel, a pessoa caía em `/agenda` na aba padrão
 * ("Hoje"), via três colunas escritas "Sem atividades" e, por cima, uma gaveta
 * com uma tarefa do dia 10. Nada ligava as duas coisas.
 */
describe('a navegação para a agenda se posiciona', () => {
  it('troca a aba quando a atual não contém a atividade', () => {
    expect(AGENDA).toContain('const abaCabe =');
    expect(AGENDA).toContain("if (!abaCabe) setAba('todos');");
  });

  it('leva o calendário para o mês da atividade', () => {
    expect(AGENDA).toContain('setMes(new Date(inicio.getFullYear(), inicio.getMonth(), 1));');
  });

  /**
   * Só quando veio de FORA. Reagir ao id aberto reposicionaria o quadro toda
   * vez que alguém clicasse num cartão com a mão.
   */
  it('reposiciona uma vez, e só vindo da URL', () => {
    expect(AGENDA).toContain('const [veioDeFora, setVeioDeFora] = useState<string | null>(null);');
    expect(AGENDA).toContain('setVeioDeFora(null);');
    expect(AGENDA).toContain("useAbrirPorUrl('compromisso', (id) => { setDetalheId(id); setVeioDeFora(id); }");
  });

  /** O anel responde "o que eu cliquei" — e rola até ele, senão marca para ninguém. */
  it('o cartão apontado é destacado e trazido para a tela', () => {
    expect(CARTAO).toContain('apontado && ');
    expect(CARTAO).toContain("scrollIntoView({ block: 'center', behavior: 'smooth' })");
  });
});

/**
 * TELA BRANCA NÃO É MENSAGEM DE ERRO.
 *
 * Sem os arquivos de erro, qualquer exceção de componente dava "Application
 * error: a client-side exception has occurred (see the browser console)".
 * Aconteceu de verdade ao clicar num processo: o painel inteiro morria.
 */
describe('quando uma tela quebra', () => {
  it('o painel tem rede, e o menu sobrevive', () => {
    expect(ERRO_PAINEL).toContain("'use client'");
    expect(ERRO_PAINEL).toContain('Esta página não abriu');
    expect(ERRO_PAINEL).toContain('onClick={reset}');
  });

  /** O `digest` é o que liga a tela à linha do log — escondê-lo transfere trabalho. */
  it('mostra o código que resolve o chamado', () => {
    expect(ERRO_PAINEL).toContain('error.digest');
    expect(ERRO_GLOBAL).toContain('error.digest');
  });

  /**
   * O global renderiza as próprias tags e NÃO importa o sistema de design: se o
   * que quebrou foi o layout, importar componente dele é convidar a segunda
   * queda.
   */
  it('a rede global não depende do que pode ter quebrado', () => {
    expect(ERRO_GLOBAL).toContain('<html lang="pt-BR">');
    expect(ERRO_GLOBAL).not.toContain("from '@/components");
    expect(ERRO_GLOBAL).not.toContain("from '@/lib");
  });
});

/**
 * FALHAR NÃO É "NÃO TEM NADA".
 *
 * O painel de vínculos lia o erro da API como lista vazia e escrevia "Nenhum
 * processo pendente de vínculo" ao lado de um contador dizendo 29. A rota dele
 * estava sendo engolida por `/processos/:id` — e a tela transformou um bug
 * gritante num estado que parecia normal.
 */
describe('erro não se disfarça de vazio', () => {
  const PAINEL_VINCULOS = ler('components/processos/resolver-vinculos-panel.tsx');

  it('a falha tem tela própria, com o motivo e um botão de tentar de novo', () => {
    expect(PAINEL_VINCULOS).toContain('isError');
    expect(PAINEL_VINCULOS).toContain('Não foi possível carregar a fila.');
    expect(PAINEL_VINCULOS).toContain('onClick={() => refetch()}');
  });

  /** E o "vazio" só aparece quando a consulta REALMENTE respondeu vazia. */
  it('o vazio exige resposta bem-sucedida', () => {
    expect(PAINEL_VINCULOS).toContain('{!isLoading && !isError && casos.length === 0 && (');
  });
});

/**
 * O MESMO DEFEITO ESTAVA EM MAIS TRÊS TELAS.
 *
 * `const { data = [] } = useQuery(...)` seguido de `length === 0 → "Nenhum…"`
 * transforma toda falha de rede numa afirmação tranquila de que não há nada. É
 * um padrão, não um descuido isolado — por isso a correção é um componente, e
 * não três blocos copiados.
 */
describe('nenhuma tela nova confunde falha com vazio', () => {
  const COMPARTILHADO = ler('components/falha-ao-carregar.tsx');
  const TELAS: [string, string][] = [
    ['publicações', 'app/(dashboard)/publicacoes/page.tsx'],
    ['relatórios', 'app/(dashboard)/relatorios/page.tsx'],
    ['auditoria', 'app/(dashboard)/auditoria/page.tsx'],
  ];

  it('o componente existe e mostra a mensagem da API', () => {
    expect(COMPARTILHADO).toContain('response?.data?.message');
    expect(COMPARTILHADO).toContain('Não foi possível carregar');
  });

  it.each(TELAS)('%s trata o erro à parte', (_nome, caminho) => {
    const src = ler(caminho);
    expect(src).toContain('<FalhaAoCarregar');
    expect(src).toContain('isError');
    expect(src).toContain('refetch()');
  });

  /** Relatório que falhou e mostra cartões zerados afirma que a equipe não entregou nada. */
  it('o relatório não desenha números quando a consulta falhou', () => {
    expect(ler('app/(dashboard)/relatorios/page.tsx')).toContain('{data && !isError && (');
  });
});

/**
 * "INSTITUCIONAL" NÃO QUER DIZER QUE O SINDICATO É O AUTOR.
 *
 * A lista de processos escondia o nome do autor em toda ação institucional, na
 * premissa de que o selo ao lado já dizia quem era. A premissa é falsa quando o
 * sindicato é RÉU — e há três processos assim na produção: SINSEP × SENATEPI,
 * SINDHOSPI × SENATEPI e uma contabilidade × SINDICATO DOS ENFERMEIROS.
 *
 * Esconder o autor ali escondia exatamente quem está nos processando: a linha
 * lia-se como se fôssemos nós a processar. O painel de vínculos oferece
 * "marcar institucional" para esses três casos, então a premissa errada
 * passaria a valer para eles no dia seguinte.
 */
describe('ação institucional com o sindicato no polo passivo', () => {
  const LISTA = ler('app/(dashboard)/processos/page.tsx');
  const PARTES_API = readFileSync(
    resolve(__dirname, '../../../api/src/modules/processos/partes.service.ts'),
    'utf8',
  );

  it('a lista só omite o autor quando o autor É o sindicato', () => {
    expect(LISTA).toContain(
      'const autorRedundante = institucional && outrosAtivo === 0 && !!autor?.institucional;',
    );
  });

  /**
   * A MARCA SAI DA FLAG DO CADASTRO, não de comparar nome. "SENATEPI",
   * "SINDICATO DOS ENFERMEIROS…" e a razão social inteira são a mesma entidade
   * escrita de três jeitos; só a flag sabe disso.
   */
  it('a API manda a marca institucional junto da parte', () => {
    expect(PARTES_API).toContain('institucional: true,');
    expect(PARTES_API).toContain('const marcar = (p: T | null)');
    expect(PARTES_API).toContain('autor: marcar(destaque(ativo)),');
    expect(PARTES_API).toContain('reu: marcar(destaque(passivo)),');
  });
});

/**
 * ACHAR AS AÇÕES POR PAPEL DO SINDICATO.
 *
 * O acervo era lido por réu e por pedido, nunca pelo papel da própria entidade.
 * São três respostas e elas particionam o acervo: autor 93, patrono do filiado
 * 31, réu 3 — soma 127, o total.
 */
describe('de que lado estamos', () => {
  const FILTROS = ler('components/processos/painel-de-filtros.tsx');
  const LISTA = ler('app/(dashboard)/processos/page.tsx');
  const PANORAMA = ler('app/(dashboard)/panorama/page.tsx');
  const SHEET = ler('components/processos/processo-detalhe-sheet.tsx');

  it('o filtro tem as três opções, e não duas', () => {
    expect(FILTROS).toContain('Nosso papel no processo');
    expect(FILTROS).toContain('<option value="AUTOR">Somos autor</option>');
    expect(FILTROS).toContain('<option value="REU">Somos réu</option>');
    expect(FILTROS).toContain('<option value="REPRESENTANDO">Representamos o filiado</option>');
  });

  /**
   * NÃO SE CONFUNDE COM O FILTRO DE POLO, que é o lado da parte PROCURADA —
   * refinamento do nome digitado, não recorte do acervo. Dois selects vizinhos
   * dizendo "autor/réu" seriam a mesma pergunta com respostas diferentes.
   */
  it('continua distinto do lado da parte procurada', () => {
    expect(FILTROS).toContain('Lado da parte procurada');
    expect(FILTROS).toContain('Nosso papel no processo');
  });

  /** Filtro que só existe atrás de um botão é filtro que ninguém encontra. */
  it('é alcançável por link', () => {
    expect(LISTA).toContain("useFiltroPorUrl(\n    'nossoPapel',");
    expect(PANORAMA).toContain('/processos?nossoPapel=REU');
    expect(PANORAMA).toContain('/processos?nossoPapel=AUTOR');
    expect(PANORAMA).toContain('/processos?nossoPapel=REPRESENTANDO');
  });

  /**
   * O SELO DIZ QUAL LADO. "Ação institucional" num processo em que somos o réu
   * afirma o contrário do que aconteceu — e são três processos assim.
   */
  it('o selo distingue autor de réu', () => {
    expect(LISTA).toContain('const somosReu = !!reu?.institucional && !autor?.institucional;');
    expect(LISTA).toContain('${tenant.sigla} é réu');
    expect(SHEET).toContain('${tenant.sigla} é réu');
  });

  /** Zero aparece: "nunca fomos processados" é informação. */
  it('o panorama mostra os três, inclusive zerado', () => {
    expect(PANORAMA).toContain('function CartaoPapel(');
    expect(PANORAMA).toContain('De que lado estamos');
    expect(PANORAMA).not.toContain('valor > 0 &&');
  });
});

/**
 * A AUDITORIA FALA PORTUGUÊS — e o rosto do responsável entra na lista.
 */
describe('a auditoria legível', () => {
  const LIB_AUD = ler('lib/auditoria.ts');
  const TELA_AUD = ler('app/(dashboard)/auditoria/page.tsx');
  const PAINEL = ler('app/(dashboard)/dashboard/page.tsx');

  /**
   * "processos/instancias/reavaliar" não é um lugar, é um endereço. A coluna
   * "Onde" precisa dizer o MÓDULO, que é o que a pessoa procura.
   */
  it('a coluna "onde" traduz rota e modelo', () => {
    expect(LIB_AUD).toContain('const NOME_DO_MODULO: Record<string, string>');
    expect(LIB_AUD).toContain('const NOME_DO_MODELO: Record<string, string>');
    expect(LIB_AUD).toContain("MovimentacaoProcessual: 'Andamento do processo'");
  });

  /** A rota crua é pista técnica: fica no detalhe, não na frase. */
  it('a rota original aparece no detalhe expandido', () => {
    expect(LIB_AUD).toContain('rotaOriginal: string | null;');
    expect(TELA_AUD).toContain('{r.rotaOriginal && <Detalhe rotulo="Rota chamada"');
  });

  /**
   * O ROSTO ANTES DO NOME. Numa lista de seis publicações, o nome do
   * responsável é a coluna que se lê por último; a foto responde "isto é meu?"
   * sem obrigar a ler.
   */
  it('a publicação mostra a foto do advogado responsável', () => {
    expect(PAINEL).toContain('url={pub.processo.advogado.avatarUrl}');
    expect(PAINEL).toContain("tamanho=\"xs\"");
  });
});
