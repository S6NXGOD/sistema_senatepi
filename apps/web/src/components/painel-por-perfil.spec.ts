import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ler = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

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
