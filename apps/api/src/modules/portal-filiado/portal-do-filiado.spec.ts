import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apenasDigitosDoCpf } from './portal-filiado-auth.service';
import {
  TAMANHO_MINIMO_SENHA,
  TOTAL_DE_PALAVRAS,
  gerarSenhaProvisoria,
  motivoDeSenhaFraca,
} from './senha-provisoria.util';

/** O fonte sem comentários — negativa mira CÓDIGO, nunca a prosa que explica. */
const semComentario = (rel: string) =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * "QUERO INSISTIR, O PORTAL SÓ LOGA COM CPF, QUEM NÃO TEM CPF CADASTRADO VAI
 * TER QUE SE RECADASTRAR NA SECRETARIA." — o dono, 25/09/2026.
 *
 * Eu tinha aberto para CPF **ou** matrícula por causa da medição (5.810
 * ATIVOS): matrícula 5.810 (100%), CPF 2.293 (39%). Ele insistiu, com o
 * encaminhamento explícito, e é decisão dele.
 *
 * O QUE O CÓDIGO TEM DE GARANTIR, então, é que **ninguém receba uma senha que
 * não vai funcionar**: a emissão recusa cadastro sem CPF, a ficha avisa a
 * secretaria antes do clique, e o recadastramento só cria o acesso de quem
 * informou CPF. Sem essas três, a decisão viraria ligação para a secretaria.
 */
describe('a porta do portal é o CPF, e só ele', () => {
  it('tira a máscara, que é como o CPF chega do celular', () => {
    expect(apenasDigitosDoCpf('123.456.789-00')).toBe('12345678900');
    expect(apenasDigitosDoCpf(' 123 456 789 00 ')).toBe('12345678900');
  });

  it('não quebra com vazio', () => {
    expect(apenasDigitosDoCpf('')).toBe('');
    expect(apenasDigitosDoCpf('   ')).toBe('');
  });

  /** A matrícula não abre mais porta nenhuma: a consulta é por CPF. */
  it('o login procura por CPF, e não por matrícula', () => {
    const auth = semComentario('./portal-filiado-auth.service.ts');
    expect(auth).toContain('prisma.filiado.findUnique(');
    expect(auth).toContain('where: { cpf },');
    // O `OR` de duas chaves era a busca por matrícula; não pode voltar.
    expect(auth).not.toContain('OR: [');
  });

  /**
   * SEM CPF A EMISSÃO RECUSA — com uma frase que diz o que fazer. É o que
   * impede a pior combinação: secretaria dita a senha, pessoa tenta, leva
   * "CPF ou senha inválidos", e ninguém descobre que faltava um campo.
   */
  it('não emite senha para cadastro sem CPF', () => {
    const auth = semComentario('./portal-filiado-auth.service.ts');
    expect(auth).toContain("if (!filiado.cpf?.trim()) {");
    expect(auth).toContain('Atualize o cadastro (ou peça o recadastramento)');
  });

  /** E a ficha mostra isso ANTES do clique. */
  it('a ficha diz se a pessoa consegue entrar', () => {
    const admin = semComentario('./portal-filiado-admin.controller.ts');
    expect(admin).toContain('temCpf: !!f.cpf?.trim(),');
  });
});

/**
 * A SENHA PROVISÓRIA É DITADA EM VOZ ALTA.
 *
 * Quem usa isto é a secretaria, no balcão e no telefone. Doze caracteres
 * aleatórios são ótimos num gerenciador e péssimos ditados: quem escuta erra o
 * "l" e o "1", e liga de volta.
 */
describe('a senha provisória', () => {
  it('sai no formato PALAVRA-PALAVRA-NN', () => {
    for (let i = 0; i < 50; i++) {
      expect(gerarSenhaProvisoria()).toMatch(/^[A-Z]{2,8}-[A-Z]{2,8}-\d{2}$/);
    }
  });

  /** "SOL-SOL-42" parece defeito do gerador, e corta o espaço de busca. */
  it('nunca repete a mesma palavra', () => {
    for (let i = 0; i < 200; i++) {
      const [a, b] = gerarSenhaProvisoria().split('-');
      expect(a).not.toBe(b);
    }
  });

  it('não é sempre a mesma', () => {
    const vistas = new Set(Array.from({ length: 200 }, () => gerarSenhaProvisoria()));
    expect(vistas.size).toBeGreaterThan(150);
  });

  /**
   * A LISTA NÃO PODE ENCOLHER SEM ALGUÉM PERCEBER: o espaço é
   * 64 × 63 × 90, e é o que sustenta uma senha de uma vez só.
   */
  it('o vocabulário tem o tamanho que a conta do espaço assume', () => {
    expect(TOTAL_DE_PALAVRAS).toBeGreaterThanOrEqual(64);
  });

  /** Sem acento, sem cedilha e sem "Ç": tudo isso some ou erra ao ser ditado. */
  it('as palavras sobrevivem a ser faladas e digitadas', () => {
    for (let i = 0; i < 200; i++) {
      const [a, b] = gerarSenhaProvisoria().split('-');
      for (const palavra of [a, b]) {
        expect(palavra).toMatch(/^[A-Z]+$/);
      }
    }
  });
});

describe('a senha escolhida pela pessoa', () => {
  it('recusa a curta demais', () => {
    expect(motivoDeSenhaFraca('123')).toContain(String(TAMANHO_MINIMO_SENHA));
    expect(motivoDeSenhaFraca('     ')).toBeTruthy();
  });

  /**
   * E NÃO EXIGE MAIÚSCULA, NÚMERO E SÍMBOLO. Num portal de 5.810 pessoas, muitas
   * no celular e com pressa, essa regra produz senha anotada no verso da
   * carteirinha — que é pior do que uma senha curta. A trava que importa é a
   * troca obrigatória da provisória, que circulou por WhatsApp.
   */
  it('aceita a senha simples que a pessoa vai lembrar', () => {
    expect(motivoDeSenhaFraca('enfermagem')).toBeNull();
    expect(motivoDeSenhaFraca('123456')).toBeNull();
  });
});

/**
 * O CORTE DE VISIBILIDADE — a parte deste módulo que não pode errar.
 *
 * O portal é aberto do celular da pessoa e do computador do serviço. Três
 * coisas nunca saem por ele, e cada uma tem um motivo concreto:
 *
 *  1. DADO DE OUTRA PESSOA. Um processo pode ter VÁRIOS filiados como parte
 *     (ação coletiva/plúrima). Listar "as partes" mostraria o nome e o CPF de
 *     um filiado para outro.
 *  2. NOTA INTERNA. `movimentacoesInternas` é a conversa da equipe sobre o caso.
 *  3. VOCABULÁRIO DE TRABALHO. Etiquetas, urgência, fila, responsável.
 */
describe('o que o portal NÃO deixa sair', () => {
  const servico = semComentario('./portal-filiado.service.ts');

  it.each([
    ['nota interna da equipe', 'movimentacoesInternas'],
    ['as outras partes do processo', 'partesBrutas'],
    ['o vocabulário interno', 'etiquetas'],
    ['a urgência e o motivo dela', 'urgenteMotivo'],
    ['o teor do ato, que nomeia terceiros', 'conteudo: true'],
  ])('não seleciona %s', (_o, campo) => {
    expect(servico).not.toContain(campo);
  });

  /**
   * E O `select` DE PARTES NÃO EXISTE: o vínculo é usado só no `where`, para
   * achar os processos da pessoa. Se um dia alguém precisar mostrar partes, vai
   * ter de apagar este teste — e aí a decisão é consciente.
   */
  it('usa o vínculo de partes só para FILTRAR, nunca para exibir', () => {
    expect(servico).toContain('{ partes: { some: { filiadoId } } }');
    expect(servico).not.toMatch(/partes:\s*\{\s*select/);
  });

  /**
   * TROCAR O ID NA URL NÃO ABRE O PROCESSO DE OUTRO. A consulta da ficha casa o
   * id COM o vínculo do filiado da sessão; sem esse `AND` o portal seria uma
   * janela aberta para o acervo inteiro.
   */
  it('a ficha do processo exige o vínculo junto do id', () => {
    expect(servico).toContain('where: { AND: [{ id: processoId }, this.vinculoDoFiliado(filiadoId)] }');
  });
});

describe('a sessão é a única fonte de quem está pedindo', () => {
  const controller = semComentario('./portal-filiado.controller.ts');

  /**
   * NENHUMA ROTA DO PORTAL RECEBE UM `filiadoId` PELA URL. O id vem sempre de
   * `@FiliadoAtual('id')`, que a estratégia releu do banco. Um `:filiadoId` em
   * qualquer rota daqui seria a porta para ler o cadastro dos outros.
   */
  it('nenhuma rota aceita filiadoId pela URL', () => {
    expect(controller).not.toMatch(/@Param\(\s*'(filiadoId|id)'/);
    expect(controller).toContain("@FiliadoAtual('id')");
  });

  /**
   * E NADA AQUI É ALCANÇÁVEL COM A SENHA PROVISÓRIA. `@PermiteSenhaProvisoria`
   * só existe nas duas rotas da troca; se aparecer no controller de conteúdo,
   * um `curl` com o token provisório usaria o portal inteiro sem trocar a senha.
   */
  it('o conteúdo exige que a senha provisória já tenha sido trocada', () => {
    expect(controller).toContain('@UseGuards(FiliadoJwtGuard)');
    expect(controller).not.toContain('PermiteSenhaProvisoria');
  });
});

/**
 * O LADO DA SECRETARIA passa pela MATRIZ, e só por ela.
 *
 * `@Roles` numa rota atropela a matriz em silêncio — é a dívida que a casa
 * passou o mês pagando, com 71 usos removidos. Código novo não a recria.
 */
describe('a liberação do acesso é da equipe, pela matriz', () => {
  const admin = semComentario('./portal-filiado-admin.controller.ts');

  it('entra pelo módulo de filiados, sem uma segunda autorização', () => {
    expect(admin).toContain("@Modulo('filiados')");
    expect(admin).toContain("@ModuloTenant('filiados')");
    expect(admin).not.toContain('@Roles');
  });

  /** O portal do filiado NÃO é rota da equipe: `@Public()` desliga os guards globais. */
  it('e o portal em si não usa os guards do administrativo', () => {
    for (const arquivo of ['./portal-filiado.controller.ts', './portal-filiado-auth.controller.ts']) {
      const fonte = semComentario(arquivo);
      expect(fonte).toContain('@Public()');
      expect(fonte).not.toContain('@Modulo(');
    }
  });
});

/**
 * A SENHA NUNCA É GRAVADA EM LUGAR NENHUM ALÉM DO HASH.
 *
 * Ela sai UMA vez, pela resposta HTTP de quem a emitiu. O log de auditoria
 * registra que houve emissão e quem fez — nunca o valor. Um log com senha em
 * claro é pior do que não ter log.
 */
describe('a senha provisória não vaza pelo log', () => {
  const auth = semComentario('./portal-filiado-auth.service.ts');

  it('a auditoria da emissão não leva a senha', () => {
    /*
      O RECORTE É O BLOCO DA AUDITORIA, e não o método inteiro: a linha
      `bcrypt.hash(senhaProvisoria, ...)` é o uso legítimo do valor e uma
      negativa larga reprovaria o arquivo certo — que é o erro mais repetido
      deste repositório.
    */
    const metodo = auth.slice(auth.indexOf('emitirSenhaProvisoria'));
    const inicio = metodo.indexOf('this.audit.registrar({');
    expect(inicio).toBeGreaterThan(-1);
    const bloco = metodo.slice(inicio, metodo.indexOf('});', inicio));
    expect(bloco).not.toContain('senhaProvisoria');
    expect(bloco).toContain('entidade:');
  });

  /** E o hash tem custo de verdade — 12 rounds, o mesmo do portal patronal. */
  it('o hash usa o mesmo custo da casa', () => {
    expect(auth).toContain('const BCRYPT_ROUNDS = 12;');
  });

  /**
   * O TEMPO DE RESPOSTA NÃO DENUNCIA QUEM É FILIADO. Sem o hash falso, um CPF
   * inexistente responderia na hora e um cadastrado esperaria o bcrypt — e a
   * diferença diria quais CPFs pertencem a profissionais de saúde do estado.
   */
  it('compara contra um hash falso quando não acha ninguém', () => {
    expect(auth).toContain('HASH_FALSO');
    expect(auth).toContain('filiado?.portalSenhaHash ?? HASH_FALSO');
  });

  /** Uma mensagem só para todos os motivos de recusa. */
  it('a recusa não diz qual foi o motivo', () => {
    expect(auth).toContain("'CPF ou senha inválidos.'");
  });
});

/**
 * O PRIMEIRO ACESSO NASCE NO RECADASTRAMENTO — mas SÓ o primeiro.
 *
 * "uma senha provisória gerada pelo sistema tanto pelo admin como no
 * recadastramento (caso seja o primeiro login)" — o dono, 24/09/2026.
 *
 * "CASO SEJA O PRIMEIRO LOGIN" É A PARTE QUE IMPORTA. Gerar sempre derrubaria a
 * senha de quem JÁ usa o portal: a pessoa se recadastra e, na semana seguinte,
 * não entra mais — sem nenhum aviso, porque o recadastramento deu certo.
 */
describe('o recadastramento cria o acesso só quando ainda não existe', () => {
  const link = semComentario('../recadastramento/link-recadastramento.service.ts');

  it('só emite quando não há hash', () => {
    expect(link).toContain('if (!f || f.portalSenhaHash) return null;');
  });

  /**
   * E SÓ COM CPF. A leitura é DEPOIS do update de propósito: quem chegou sem
   * CPF e informou um agora ganhou a porta do portal nesta mesma tela.
   */
  it('e só para quem tem CPF — lido depois de gravar o recadastramento', () => {
    expect(link).toContain("if (!f.cpf?.trim()) return null;");
  });

  /** E a emissão NUNCA derruba o recadastramento, que já foi gravado. */
  it('falha na emissão não desfaz o recadastramento', () => {
    const trecho = link.slice(link.indexOf('senhaDoPortalSeForPrimeiraVez('));
    expect(trecho).toContain('try {');
    expect(trecho).toContain('} catch {');
    expect(trecho).toContain('return null;');
  });

  /** Quem gerou foi o próprio filiado, não a equipe: a auditoria diz isso. */
  it('a auditoria não atribui a emissão a um usuário da equipe', () => {
    expect(link).toContain("{ id: null, nome: 'recadastramento online' }");
  });
});

/**
 * DESFILIADO PERDE O PORTAL NA HORA.
 *
 * A desfiliação tem porta própria desde 27/08 e nenhuma delas mexe na senha.
 * Sem esta trava, quem saiu do quadro continuaria vendo carteirinha, processos
 * e cobranças até o token vencer — 8 horas depois.
 */
describe('quem saiu do quadro perde o acesso', () => {
  const estrategia = semComentario('./strategies/filiado-jwt.strategy.ts');

  it('a estratégia recusa DESFILIADO a cada requisição', () => {
    expect(estrategia).toContain('SituacaoFiliado.DESFILIADO');
    expect(estrategia).toContain('prisma.filiado.findUnique');
  });

  /**
   * E INATIVO CONTINUA ENTRANDO, de propósito: é quem está em atraso ou
   * suspenso — justamente quem precisa ver a própria cobrança para voltar.
   */
  it('mas INATIVO continua entrando', () => {
    expect(estrategia).not.toContain('SituacaoFiliado.INATIVO');
  });

  /** O estado vem do BANCO, não do token: revogar tem efeito imediato. */
  it('o estado do primeiro acesso vem do banco, não do token', () => {
    expect(estrategia).toContain('primeiroAcesso: filiado.portalPrimeiroAcesso');
  });
});
