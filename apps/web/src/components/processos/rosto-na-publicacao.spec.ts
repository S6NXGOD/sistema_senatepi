import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const CARD = lerCodigo('publicacao-djen-card.tsx');

/**
 * QUAL DOS NOSSOS ADVOGADOS FOI INTIMADO — pelo rosto, antes da leitura.
 *
 * A publicação lista de quatro a oito advogados e quase todos são da outra
 * parte. Os nossos ficavam atrás de um clique, numa lista fechada de nomes em
 * caixa alta. Numa aba com 1.408 atos, descobrir "isto é meu?" custava abrir
 * cada cartão.
 *
 * Medido em 07/09/2026: **1.381 das 1.408 publicações** têm um advogado do
 * quadro identificável pela OAB, e os oito advogados têm foto cadastrada. A
 * cobertura justifica o espaço na tela.
 */
describe('o rosto do advogado na publicação', () => {
  it('a pilha de rostos existe e vai para o cabeçalho do cartão', () => {
    expect(CARD).toContain('function RostosDosNossos');
    expect(CARD).toContain('<RostosDosNossos advogados={advogados} />');
  });

  /**
   * CASAR POR NOME PERDERIA TODO MUNDO COM ACENTO. O DJEN manda "ICARO SOL
   * ALMONDES SANTOS"; o cadastro tem "Ícaro Sol Almondes Santos". Número da
   * OAB + UF é exato e não confunde homônimo.
   */
  it('casa pela OAB, nunca pelo nome', () => {
    expect(CARD).toContain('const chaveOab =');
    expect(CARD).toContain("replace(/\\D/g, '')");
    expect(CARD).toContain('.trim().toUpperCase()');
    // A UF entra na chave: "3778/PI" e "3778/SP" são pessoas diferentes.
    expect(CARD).toMatch(/\$\{\(uf \?\? ''\)\.trim\(\)\.toUpperCase\(\)\}-\$\{soDigitos\(numero\)\}/);
  });

  /** O mesmo advogado citado duas vezes na publicação não vira dois rostos. */
  it('deduplica pela chave', () => {
    expect(CARD).toContain('const achados = new Map<string, AdvogadoDisponivel>()');
    expect(CARD).toContain('achados.set(k, nosso)');
  });

  /**
   * UMA REQUISIÇÃO PARA A PÁGINA INTEIRA. São dezenas de cartões; sem a chave
   * de cache compartilhada com o painel de filtros, cada um faria a sua.
   */
  it('reaproveita o cache da lista de advogados', () => {
    expect(CARD).toContain("queryKey: ['processos', 'advogados-disponiveis']");
    expect(CARD).toContain('staleTime:');
  });

  /** Sem advogado nosso na publicação, nada aparece — nem espaço vazio. */
  it('some quando nenhum é nosso', () => {
    expect(CARD).toContain('if (!nossos.length) return null;');
  });

  /**
   * MOBILE-FIRST: três rostos cabem ao lado da data no celular; mais que isso
   * empurra a data para fora da linha. O nome só acompanha quando é UM — com
   * dois, um nome sozinho mentiria por omissão.
   */
  it('limita a três rostos e só nomeia quando é um', () => {
    expect(CARD).toContain('nossos.slice(0, 3)');
    expect(CARD).toContain('nossos.length === 1 ?');
    expect(CARD).toContain('`+${nossos.length - 3}`');
    expect(CARD).toContain('hidden truncate');
    expect(CARD).toContain('sm:inline');
  });

  /** A lista completa continua no expansor: os da outra parte também importam. */
  it('não substitui a lista de todos os intimados', () => {
    expect(CARD).toContain('advogado intimado');
    expect(CARD).toContain('advogados intimados');
  });
});

/**
 * O DIÁLOGO PEDIA O QUE JÁ TINHA NA MÃO.
 *
 * A fila mostra "Contra HAPVIDA ASSISTENCIA MEDICA LTDA · HAPVIDA PARTICIPACOES"
 * — nomes que vieram do Diário. Clicando em Cadastrar, o diálogo abria com o
 * NPU preenchido, os dois polos VAZIOS, e um aviso dizendo que "o CNJ não
 * divulga as partes na API pública".
 *
 * O aviso é verdade sobre o DATAJUD, que é de onde vem a prévia. É mentira
 * sobre o DJEN, que traz `destinatarios` com nome e polo. O efeito era pedir
 * que a pessoa digitasse o que o sistema tinha acabado de exibir.
 */
describe('as partes que o Diário já disse', () => {
  const DIALOGO = lerCodigo('importar-processo-dialog.tsx');

  it('o diálogo aceita as partes de quem o abriu', () => {
    expect(DIALOGO).toContain('partesIniciais?: { nome?: string | null; polo?: string | null }[] | null;');
    /*
      `doDiario` virou `semAmbiguas`: a mesma função, agora tirando a parte que
      o Diário lista nos DOIS polos (recurso). O que este teste garante continua
      sendo o mesmo — que os dois polos são semeados a partir do que veio.
    */
    expect(DIALOGO).toContain('setPoloAtivo(semAmbiguas(nosAtivos));');
    expect(DIALOGO).toContain('setReus(semAmbiguas(nosPassivos));');
  });

  /**
   * ENTRAM COMO RASCUNHO, nunca como vínculo: é o nome como o TRIBUNAL escreveu.
   * Quem confere troca por um filiado ou por uma organização com um clique.
   */
  it('entram como avulsas, editáveis', () => {
    expect(DIALOGO).toContain("tipo: 'AVULSA'");
    expect(DIALOGO).toContain("detalhe: 'Como consta no Diário'");
  });

  /**
   * O SINDICATO TEM TIPO PRÓPRIO. Entrar como avulsa criaria uma segunda "parte
   * SENATEPI" solta no cadastro — a duplicata que o gate de organizações existe
   * para evitar.
   */
  it('e o sindicato entra como institucional, não como avulsa', () => {
    expect(DIALOGO).toContain("tipo: 'INSTITUCIONAL', nome: tenant.nome");
    /*
      A REGRA MORA FORA DAQUI, e o teste dela também.

      Esta asserção já foi `toContain('normalizarNome(tenant.sigla)')` — conferia
      que a linha existia, não que ela acertava. Ficou verde durante todo o tempo
      em que a normalização importada era a errada (a de `editor-de-partes`, que
      cola o nome inteiro num token só) e o SENATEPI entrava como parte AVULSA na
      tela do usuário. Quem cobre o comportamento agora é
      `lib/sigla-do-sindicato.spec.ts`, com os nomes reais do acervo; aqui fica
      só o que é do diálogo: que ele CHAMA a regra em vez de ter a sua.
    */
    expect(DIALOGO).toContain("from '@/lib/sigla-do-sindicato'");
    expect(DIALOGO).toContain('ehOSindicato(nome, tenant.sigla)');
    expect(DIALOGO).not.toContain('function ehOSindicato');
  });

  /** O mesmo nome vem repetido em recurso — não pode virar duas linhas. */
  it('deduplica o nome repetido no ato', () => {
    expect(DIALOGO).toContain('todas.findIndex((o) => o.nome === parte.nome) === i');
  });

  /** E o texto deixa de mentir quando as partes vieram. */
  it('o aviso passa a dizer a verdade', () => {
    expect(DIALOGO).toContain('const veioDoDiario = !!partesIniciais?.length;');
    expect(DIALOGO).toContain('Partes preenchidas com o que o Diário publicou');
  });
});

/**
 * A FILA DE AÇÕES É GLOBAL — e por isso precisa dizer de quem é cada uma.
 *
 * Todo advogado com permissão de editar processos vê as trinta, e só algumas o
 * citam. Esconder as dos outros seria pior: é fila compartilhada com resolução
 * única, e quem cadastrar primeiro limpa para todos. Mas sem a cara, achar as
 * suas exige abrir uma a uma — e lista alheia com cara de prazo ensina a
 * ignorar a lista.
 *
 * O rosto vem do advogado NOMEADO NO ATO (a OAB que trouxe a ação até a fila),
 * e não de um palpite: medido em 07/09/2026, 30 das 30 têm.
 */
describe('de quem é a ação encontrada', () => {
  const FILA = lerCodigo('acoes-encontradas.tsx');

  it('a linha mostra o rosto de quem o ato nomeia', () => {
    expect(FILA).toContain('s.advogadosNossos?.length');
    expect(FILA).toContain('<AvatarPessoa');
    expect(FILA).toContain('citado neste ato');
  });

  /** Três cabem ao lado do número no celular; mais empurram a linha. */
  it('limita a três rostos', () => {
    expect(FILA).toContain('s.advogadosNossos.slice(0, 3)');
  });

  /**
   * E O CADASTRO NÃO PERGUNTA O QUE O ATO JÁ RESPONDEU — inclusive quando o ato
   * nomeia UM advogado só.
   *
   * Este teste travava `advogadosIniciais.length > 1 ? advogadosIniciais : []`,
   * e aquele `[]` apagava o advogado da TELA: o seletor desenha a partir de
   * `ids`, então com a lista vazia ele mostrava "Selecionar advogado(s)…"
   * mesmo com `advogadoId` preenchido por baixo. O dado ia certo para o
   * servidor e a tela dizia que não havia ninguém.
   *
   * Medido na fila em 07/09/2026: 11 das 30 ações têm EXATAMENTE um advogado
   * nosso citado. Um terço abria sem advogado à vista; as com dois ou três
   * abriam certas, o que fazia o defeito parecer aleatório.
   *
   * A causa foi confundir estado de TELA com formato de ENVIO. Escolher um
   * advogado à mão sempre produziu `ids: [ele]`; o preenchimento automático
   * agora faz igual.
   */
  it('o advogado do ato vai junto no cadastro, mesmo sendo um só', () => {
    const DIALOGO = lerCodigo('importar-processo-dialog.tsx');
    expect(DIALOGO).toContain('advogadosIniciais?: string[] | null;');
    expect(DIALOGO).toContain("setValue('advogadoId', advogadosIniciais[0]);");
    expect(DIALOGO).toContain('setEquipeAdvogados(advogadosIniciais);');
    // O ternário que apagava o único advogado da tela não pode voltar.
    expect(DIALOGO).not.toContain('advogadosIniciais.length > 1 ? advogadosIniciais : []');
  });
});

/**
 * A FOTO NUNCA APARECEU — e o próprio interceptor avisava.
 *
 * A foto enviada pelo perfil mora no STORAGE: o banco guarda `avatarKey` e
 * `avatarUrl` fica nulo. Quem resolve uma na outra é o `AvataresInterceptor`,
 * global — mas ele só mexe em objeto que CARREGA a chave. Pedindo só a URL, a
 * resposta vem nula e a tela cai nas iniciais.
 *
 * Medido em 07/09/2026: os OITO advogados têm `avatarKey` e NENHUM tem
 * `avatarUrl`. A fila mostrava "T CH" no lugar da cara das pessoas.
 */
describe('a foto tem de chegar até a tela', () => {
  const SUGESTOES = readFileSync(
    resolve(__dirname, '..', '..', '..', '..', 'api', 'src', 'modules', 'processos', 'sugestoes.service.ts'),
    'utf8',
  );

  it('a consulta pede a CHAVE, e não só a URL', () => {
    const fn = SUGESTOES.slice(SUGESTOES.indexOf('private async advogadosNossosPorSugestao('));
    expect(fn.slice(0, 1800)).toContain('avatarUrl: true, avatarKey: true,');
  });
});

/**
 * COM TRINTA ITENS, clicar trinta caixinhas é o que faz ninguém usar o lote.
 */
describe('selecionar em bloco', () => {
  const FILA = lerCodigo('acoes-encontradas.tsx');

  it('dá para marcar todas de uma vez', () => {
    expect(FILA).toContain('Desmarcar todas');
    expect(FILA).toContain('Marcar todas (');
  });

  /** E o atalho que faz a fila compartilhada ser usável: as que me citam. */
  it('e marcar só as que citam quem está olhando', () => {
    expect(FILA).toContain('Marcar as minhas (');
    expect(FILA).toContain('(i.advogadosNossos ?? []).some((a) => a.id === user?.id)');
  });

  /** Não oferece um botão que daria zero. */
  it('o atalho some quando não há nenhuma minha', () => {
    expect(FILA).toContain('!!minhas.length && minhas.length < itens.length');
  });
});
