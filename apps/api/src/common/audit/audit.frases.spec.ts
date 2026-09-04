import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { descricaoLegivel, fraseDaRota, lerLinhaHttp, valeAuditar } from './audit.frases';

const ler = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const INTERCEPTOR = ler('audit.interceptor.ts');
const SERVICO = ler('audit.service.ts');

/**
 * METADE DO LOG DE AUDITORIA NÃO ERA AUDITORIA.
 *
 * Medido na produção em 04/09/2026: **1.555 de 2.977 registros (52%)** eram
 * linhas de curl — `POST /api/processos/instancias/reavaliar?limite=10`. Isso
 * não diz o que mudou, não diz sobre quem, e ainda DUPLICA o serviço que já
 * havia escrito a frase certa para o mesmo ato.
 *
 * Depois da correção, 97,7% dos mesmos 2.977 registros viram frase própria e
 * ZERO continuam crus — e isso sem tocar numa linha do banco.
 */
describe('a linha de curl vira frase', () => {
  const REAIS: [string, string][] = [
    ['POST /api/processos/instancias/reavaliar?limite=10', 'Reavaliou as instâncias dos processos'],
    ['POST /api/processos/partes/vinculos-pendentes/aplicar', 'Resolveu vínculos de filiado em lote'],
    ['PATCH /api/processos/42dd85c2-6c15-44bf/sincronizar', 'Sincronizou um processo com o DataJud'],
    ['POST /api/processos/importar', 'Importou um processo do DataJud'],
    ['POST /api/partes-externas', 'Mexeu no cadastro de uma organização'],
    ['PATCH /api/compromissos/abc-123/status', 'Mudou o andamento de uma atividade'],
    ['POST /api/auth/login', 'Entrou no sistema'],
    ['PATCH /api/profile/change-password', 'Trocou a própria senha'],
    ['POST /api/escalas', 'Mexeu na escala dos advogados'],
  ];

  it.each(REAIS)('%s → %s', (cru, esperado) => {
    expect(descricaoLegivel(cru)).toBe(esperado);
  });

  /**
   * A FRASE ESCRITA À MÃO PASSA INTACTA. Os registros dos serviços já dizem
   * exatamente o que aconteceu, com nome e tudo — mexer neles só pioraria.
   */
  it('não mexe no que já é frase', () => {
    const boa = '"SARA MACHADO MIRANDA LEAL BARBOSA" identificada como o filiado "SARA MACHADO MIRANDA"';
    expect(descricaoLegivel(boa)).toBe(boa);
    expect(descricaoLegivel('Login realizado')).toBe('Login realizado');
  });

  /** Rota desconhecida cai no genérico — que ainda se lê, ao contrário do curl. */
  it('a rota sem tradução vira algo legível mesmo assim', () => {
    expect(fraseDaRota('POST', '/api/coisa-nova/xyz')).toBe('Criou em coisa-nova');
    expect(fraseDaRota('DELETE', '/api/coisa-nova/xyz')).toBe('Excluiu em coisa-nova');
  });

  it('reconhece a linha http e devolve as duas partes', () => {
    expect(lerLinhaHttp('POST /api/x?y=1')).toEqual({ metodo: 'POST', caminho: '/api/x?y=1' });
    expect(lerLinhaHttp('Login realizado')).toBeNull();
    expect(lerLinhaHttp(null)).toBeNull();
  });
});

/**
 * RENOVAR TOKEN NÃO É ATO DE NINGUÉM.
 *
 * `auth/refresh` é o navegador renovando a sessão sozinho, sem clique — 40
 * registros na produção dizendo que a sessão continuou existindo. O login
 * continua registrado: "quem entrou no domingo" é uma das perguntas que trazem
 * alguém a esta tela.
 */
describe('o que não vira registro', () => {
  it('descarta a renovação de token', () => {
    expect(valeAuditar('/api/auth/refresh')).toBe(false);
  });

  /**
   * A LISTA DE PROCESSOS dispara `instancias/reavaliar` ao abrir. Foram **334
   * dos 1.245 registros crus dos últimos 30 dias** (27%) — a maior fonte
   * isolada do log, e nenhum deles pedido por alguém.
   */
  it('descarta a varredura que a tela dispara sozinha', () => {
    expect(valeAuditar('/api/processos/instancias/reavaliar?limite=0')).toBe(false);
  });

  /** Mas a rota antiga continua traduzível: 334 registros dela já estão no banco. */
  it('os registros antigos dessa rota continuam legíveis', () => {
    expect(descricaoLegivel('POST /api/processos/instancias/reavaliar?limite=10')).toBe(
      'Reavaliou as instâncias dos processos',
    );
  });

  it('mas mantém o login e o logout', () => {
    expect(valeAuditar('/api/auth/login')).toBe(true);
    expect(valeAuditar('/api/auth/logout')).toBe(true);
  });

  it('o interceptor consulta a lista antes de gravar', () => {
    expect(INTERCEPTOR).toContain('if (!valeAuditar(url)) return;');
  });
});

/**
 * DOIS REGISTROS PARA UM ATO era a outra metade do problema: o serviço escrevia
 * a frase certa E o interceptor acrescentava a linha de curl logo em seguida.
 */
describe('quem já contou, cala o outro', () => {
  it('gravar pela mão marca a requisição', () => {
    expect(SERVICO).toContain('marcarAuditadoPeloServico();');
  });

  it('o interceptor respeita a marca', () => {
    expect(INTERCEPTOR).toContain('if (jaFoiAuditadoPeloServico()) return;');
  });

  /**
   * E ELE NÃO SOME. Uma rota de escrita que ninguém instrumentou passaria a
   * não deixar rastro — e é a rota esquecida que se procura quando alguma
   * coisa desaparece do sistema.
   */
  it('o registro de último recurso continua existindo', () => {
    expect(INTERCEPTOR).toContain('descricao: fraseDaRota(req.method, url)');
    expect(INTERCEPTOR).toContain('metadata: { rota: url, metodo: req.method }');
  });
});

/**
 * SILÊNCIO NÃO PODE VIRAR BURACO.
 *
 * Tirar a rota do interceptor só é legítimo porque a varredura passou a gravar
 * ELA MESMA quando muda alguma coisa — e aí com o número do que mudou, que a
 * linha de curl nunca teve.
 */
describe('a varredura silenciosa deixa rastro quando muda algo', () => {
  const SERVICO_PROC = readFileSync(
    resolve(__dirname, '../../modules/processos/processos.service.ts'),
    'utf8',
  );

  /**
   * E EU AINDA CALIBREI ERRADO NA PRIMEIRA VEZ.
   *
   * Gravava quando `reavaliados > 0` — quando algum processo tinha sido RELIDO
   * no CNJ. Medido depois do deploy: OITO dos nove registros do log eram
   * "Instâncias reavaliadas — 1 processo(s) relido(s) no CNJ", sem dizer qual
   * processo, com zero mudanças em todos. Reler o CNJ é o sistema baixando dado
   * público; ninguém audita isso, e ninguém poderia questioná-lo.
   *
   * O que se audita é o STATUS que o robô muda sozinho — esse alguém contesta:
   * "quem encerrou meu processo?".
   */
  it('grava só quando o robô mudou algum status', () => {
    expect(SERVICO_PROC).toContain('if (r.realinhados.length) {');
    expect(SERVICO_PROC).not.toContain('if (r.desalinhados > 0 || r.reavaliados > 0) {');
  });

  it('e diz QUAL processo, de que status para qual', () => {
    expect(SERVICO_PROC).toContain("${m.numeroCNJ ?? 'sem número'}: ${m.de} → ${m.para}");
    expect(SERVICO_PROC).toContain("campo: 'statusInterno'");
  });

  /**
   * `reconciliarStatus` devolvia `candidatos.length` — quantos foram OLHADOS —
   * e eu chamava isso de "desalinhados" no registro. Um log que diz "3 status
   * realinhados" quando nenhum mudou é pior que log nenhum: ele parece prova.
   */
  it('conta o que mudou, e não o que foi examinado', () => {
    expect(SERVICO_PROC).toContain('const mudancas: MudancaDeStatus[] = [];');
    expect(SERVICO_PROC).toContain('if (m) mudancas.push(m);');
    expect(SERVICO_PROC).not.toContain('return candidatos.length;');
  });

  it('o controller passa quem pediu', () => {
    const CTRL = readFileSync(
      resolve(__dirname, '../../modules/processos/processos.controller.ts'),
      'utf8',
    );
    expect(CTRL).toContain('this.service.reavaliarInstancias(n, req ? this.ctx(req, userId) : { userId })');
  });
});
