import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { MOTIVO_DESFILIACAO_LABEL, formatarMesCorte, pracaDaAssinatura } from './filiados.service';

const ler = (arquivo: string) => readFileSync(path.join(__dirname, arquivo), 'utf8');
const SERVICE = ler('filiados.service.ts');
const CONTROLLER = ler('filiados.controller.ts');
const VOTACAO = readFileSync(
  path.join(__dirname, '..', 'eventos', 'votacao.service.ts'),
  'utf8',
);

/**
 * A REATIVAÇÃO TEM DE DESFAZER A SAÍDA INTEIRA.
 *
 * O modal de desfiliação promete, com todas as letras, que o cadastro "pode ser
 * reativado futuramente". A promessa era cumprida pela metade: dava para voltar
 * a situação para ATIVO pelo seletor do formulário, e só isso acontecia — os
 * cinco campos da saída continuavam gravados.
 *
 * O estrago não era cosmético. Um cadastro ATIVO carregando
 * `motivoDesfiliacao = INADIMPLENCIA` faz o Termo de Desfiliação, se reemitido,
 * sair com o motivo ANTIGO — o gerador cai no que está no cadastro quando não
 * recebe parâmetro. É um documento oficial afirmando uma saída desfeita.
 */
describe('reativação', () => {
  const reativar = SERVICE.slice(
    SERVICE.indexOf('async reativar('),
    SERVICE.indexOf('/** Exclusão permanente do cadastro'),
  );

  it('o método existe (o teste não olha para o vazio)', () => {
    expect(reativar.length).toBeGreaterThan(600);
  });

  it.each([
    'motivoDesfiliacao',
    'desfiliacaoObservacoes',
    'desfiliadoEm',
    'desfiliadoPor',
    'desfiliacaoMesCorte',
  ])('limpa `%s` — deixar qualquer um recria o defeito', (campo) => {
    expect(reativar).toMatch(new RegExp(`${campo}: null`));
  });

  it('volta a situação para ATIVO', () => {
    expect(reativar).toMatch(/situacao: SituacaoFiliado\.ATIVO/);
  });

  it('recusa reativar quem já está ativo', () => {
    expect(reativar).toMatch(/já está ativo/);
  });

  it('deixa rastro no histórico E na auditoria', () => {
    expect(reativar).toContain('registrarHistorico');
    expect(reativar).toContain('audit');
    // O motivo da saída anterior vai junto: sem ele, a linha do tempo perde a
    // ligação entre a saída e a volta.
    expect(reativar).toContain('motivoSaidaAnterior');
  });

  it('a auditoria nunca derruba a operação', () => {
    expect(reativar).toMatch(/\.catch\(\(\) => undefined\)/);
  });
});

/**
 * DESFILIAR E REATIVAR TÊM PORTAS PRÓPRIAS — E SÃO AS ÚNICAS.
 *
 * O campo "Situação" da tela de edição é um `<select>` com as três opções e
 * escrevia direto no banco, abrindo duas portas dos fundos:
 *
 *  · ENTRAR em DESFILIADO ali pulava motivo padronizado, mês de corte, Termo
 *    assinado, histórico e auditoria;
 *  · SAIR de DESFILIADO deixava os cinco campos da saída gravados.
 */
describe('as portas da desfiliação', () => {
  const porta = SERVICE.slice(
    SERVICE.indexOf('private async exigirPortaCerta'),
    SERVICE.indexOf('async update(id: string'),
  );

  it('o guarda existe', () => {
    expect(porta.length).toBeGreaterThan(300);
  });

  it('barra ENTRAR em DESFILIADO pelo caminho genérico', () => {
    expect(porta).toMatch(/novaSituacao === SituacaoFiliado\.DESFILIADO/);
    expect(porta).toMatch(/use a ação "Desfiliar"/);
  });

  it('barra SAIR de DESFILIADO pelo caminho genérico', () => {
    expect(porta).toMatch(/situacao === SituacaoFiliado\.DESFILIADO/);
    expect(porta).toMatch(/use a ação "Reativar"/);
  });

  it('não atrapalha quem não está mudando de situação', () => {
    // Sem este `return`, toda edição de telefone consultaria o banco à toa — e,
    // pior, uma edição que reenvia a MESMA situação seria recusada.
    expect(porta).toMatch(/if \(!novaSituacao\) return;/);
    expect(porta).toMatch(/if \(novaSituacao === situacao\) return;/);
  });

  it.each(['async update(id: string', 'async changeSituacao('])(
    '%s passa pelo guarda',
    (assinatura) => {
      const trecho = SERVICE.slice(SERVICE.indexOf(assinatura), SERVICE.indexOf(assinatura) + 400);
      expect(trecho).toContain('exigirPortaCerta');
    },
  );
});

/**
 * O QUE FICA PENDURADO — a resposta a "isto conversa com os outros módulos?".
 *
 * A saída era decidida às cegas. O cadastro do filiado é o centro de meia dúzia
 * de módulos e nenhum aparecia na hora de confirmar.
 */
describe('levantamento de vínculos', () => {
  const levantar = SERVICE.slice(
    SERVICE.indexOf('async levantarVinculos('),
    SERVICE.indexOf('async desfiliar('),
  );

  it('o método existe', () => {
    expect(levantar.length).toBeGreaterThan(800);
  });

  it.each([
    ['parcelaCobranca', 'dívida em aberto'],
    ['dependente', 'quem perde acesso junto'],
    ['processo', 'caso em curso'],
    ['compromisso', 'atividade na agenda'],
    ['atendimento', 'triagem sem desfecho'],
    ['carteirinha', 'documento que deixa de valer'],
  ])('conta %s (%s)', (modelo) => {
    expect(levantar).toContain(`this.prisma.${modelo}.`);
  });

  /**
   * PELA TABELA, NÃO PELO ATALHO. Um filiado pode ser parte de um processo
   * coletivo sem ser o "dono" (`Processo.filiadoId`) dele — e é justamente esse
   * caso que passaria despercebido. Mesma lição que já escondeu a carteira do
   * advogado atrás de um zero.
   */
  it('acha processo em que ele é parte sem ser o titular', () => {
    expect(levantar).toMatch(/partes: \{ some: \{ filiadoId: id \} \}/);
    expect(levantar).toMatch(/OR: \[\{ filiadoId: id \}/);
  });

  it('ignora processo já encerrado — não é pendência', () => {
    expect(levantar).toContain('StatusProcesso.ARQUIVADO');
    expect(levantar).toContain('StatusProcesso.ENCERRADO');
  });

  /** Uma transação: sete contagens em sete idas ao banco seriam sete latências. */
  it('faz tudo numa transação só', () => {
    expect(levantar).toContain('this.prisma.$transaction([');
  });

  it('é LEITURA — não bloqueia, não altera nada', () => {
    expect(levantar).not.toMatch(/\.update\(|\.create\(|\.delete\(/);
    expect(levantar).not.toMatch(/throw new (Bad|Forbidden|Conflict)/);
  });
});

describe('endpoints da desfiliação', () => {
  it('vínculos e reativar estão expostos', () => {
    expect(CONTROLLER).toMatch(/@Get\(':id\/vinculos'\)/);
    expect(CONTROLLER).toMatch(/@Patch\(':id\/reativar'\)/);
  });

  /** Saída e volta são decisão de gestão — triagem não decide quadro social. */
  it.each(["':id/desfiliar'", "':id/reativar'", "':id/vinculos'"])(
    '%s é restrito a ADMINISTRADOR e COORDENACAO',
    (rota) => {
      const i = CONTROLLER.indexOf(rota);
      expect(i).toBeGreaterThan(0);
      const bloco = CONTROLLER.slice(i, i + 200);
      expect(bloco).toContain('UserRole.ADMINISTRADOR, UserRole.COORDENACAO');
    },
  );
});

/**
 * A PRAÇA DA ASSINATURA vinha escrita "Teresina/PI" no corpo de DOIS geradores
 * de PDF. Acerta hoje, porque os dois clientes ficam em Teresina; no dia em que
 * um terceiro entrar, o sistema emite documento oficial datado da cidade errada
 * — e nada quebra, então ninguém descobre.
 */
describe('praça da assinatura no PDF', () => {
  it('sai do `tenant.config`, não do código', () => {
    /*
     * Olha as CHAMADAS `.text(...)`, não o arquivo: o comentário que documenta
     * esta correção cita "Teresina/PI" de propósito, e um `not.toContain` cru
     * reprovaria o código certo por causa da explicação dele.
     */
    const impressoes = [...SERVICE.matchAll(/\.text\(`([^`]*)`/g)].map((m) => m[1]);
    expect(impressoes.length).toBeGreaterThan(3);
    expect(impressoes.filter((t) => /Teresina/.test(t))).toEqual([]);
    expect(impressoes.filter((t) => t.includes('pracaDaAssinatura()'))).toHaveLength(2);
  });

  it('formata a cidade em caixa de nome próprio', () => {
    // A configuração guarda "TERESINA"; num documento formal isso grita.
    expect(pracaDaAssinatura()).toBe('Teresina/PI');
  });
});

/**
 * QUEM VOTA É ASSOCIADO — conferido na hora do voto, e não só no check-in.
 *
 * O check-in já recusa quem não está ATIVO, então o teste parece redundante.
 * Não é: entre entrar no salão e apertar o botão há uma assembleia inteira, e
 * nada impede que a secretaria registre uma desfiliação nesse intervalo. Numa
 * eleição sindical um voto a mais não tem como ser desfeito depois — a urna é
 * anônima de propósito.
 */
describe('voto exige cadastro ativo', () => {
  const votar = VOTACAO.slice(
    VOTACAO.indexOf('async votar('),
    VOTACAO.indexOf('const filiadoId = presenca.filiadoId;'),
  );

  it('o trecho existe', () => {
    expect(votar.length).toBeGreaterThan(600);
  });

  it('carrega a situação junto da presença', () => {
    expect(votar).toContain('filiado: { select: { situacao: true } }');
  });

  it('recusa quem não está ATIVO', () => {
    expect(votar).toMatch(/situacao !== SituacaoFiliado\.ATIVO/);
    expect(votar).toContain('não pode votar');
  });
});

/** Os rótulos alimentam o PDF, o histórico e a estatística da diretoria. */
describe('motivos de saída', () => {
  it('todo motivo do enum tem rótulo em português', () => {
    for (const [slug, label] of Object.entries(MOTIVO_DESFILIACAO_LABEL)) {
      expect(label).toBeTruthy();
      expect(label).not.toBe(slug);
    }
  });

  it('o mês de corte vira texto legível no termo', () => {
    expect(formatarMesCorte('2026-08')).toBe('agosto/2026');
    expect(formatarMesCorte('2026-01')).toBe('janeiro/2026');
  });

  it('mês fora do padrão não quebra o PDF', () => {
    expect(formatarMesCorte('agosto')).toBe('agosto');
    expect(formatarMesCorte('2026-13')).toBe('2026-13');
  });
});
