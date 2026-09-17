import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fraseSemTarefa, fraseJaCuidei, motivoLevaAoTeor } from './movimentacoes';

const RAIZ = path.resolve(__dirname, '..');
const FICHA = readFileSync(path.join(RAIZ, 'components/processos/processo-detalhe-sheet.tsx'), 'utf8');

/**
 * AS DUAS MÃOS DO ADVOGADO SOBRE O ANDAMENTO — 17/09/2026.
 *
 * "Não quero tarefas já com prazo matando o advogado; se for algo urgente,
 * mande um alerta, mas não encha de tarefas desnecessárias."
 *
 * O criador cego foi desligado (48 tarefas, 32 canceladas, 47 nascidas
 * atrasadas, 9 das 11 concluídas sem peça a fazer). Só que tirar sem devolver
 * alavanca é subtração: sobram 27 atos pedindo olho, e para cada um alguém
 * precisa poder dizer "isto é trabalho" ou "disto eu já cuidei".
 */
describe('as frases do carimbo do robô', () => {
  /** Os três motivos novos moram nas colunas próprias do robô (`avaliado*`). */
  it('cada motivo do robô vira frase de gente', () => {
    for (const motivo of ['SEM_TEOR_NO_DATAJUD', 'ANDAMENTO_ANTIGO', 'TEOR_NO_DIARIO']) {
      const frase = fraseSemTarefa(motivo);
      expect(frase).toContain('não abriu tarefa');
      // A chave técnica nunca aparece na tela.
      expect(frase).not.toContain(motivo);
      expect(frase).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    }
  });

  /**
   * As duas explicações não podem ser a mesma: "o tribunal não disse o que o
   * ato pede" e "o ato chegou tarde demais" mandam a pessoa fazer coisas
   * diferentes. Era o defeito do motivo único.
   */
  it('e cada uma diz uma coisa diferente', () => {
    expect(fraseSemTarefa('SEM_TEOR_NO_DATAJUD')).not.toBe(fraseSemTarefa('ANDAMENTO_ANTIGO'));
    expect(fraseSemTarefa('SEM_TEOR_NO_DATAJUD')).toContain('não disse o que ele pede');
    expect(fraseSemTarefa('ANDAMENTO_ANTIGO')).toContain('depois de qualquer prazo ordinário');
  });

  /** O carimbo antigo, que está gravado no banco, continua sendo entendido. */
  it('o motivo anterior continua com frase', () => {
    expect(fraseSemTarefa('ANDAMENTO_ANTIGO_SEM_TEOR')).toContain('não abriu tarefa');
  });

  it('motivo desconhecido não vaza código na tela', () => {
    expect(fraseSemTarefa('MOTIVO_QUE_AINDA_NAO_EXISTE')).toBeNull();
    expect(fraseSemTarefa(null)).toBeNull();
    expect(fraseSemTarefa(undefined)).toBeNull();
  });

  /**
   * "O teor chegou pelo Diário" sem o caminho até ele manda procurar — trocar
   * de aba e comparar datas no olho. Só este motivo aponta para a publicação;
   * os outros dois não têm para onde levar.
   */
  it('só o motivo do Diário leva ao teor', () => {
    expect(motivoLevaAoTeor('TEOR_NO_DIARIO')).toBe(true);
    expect(motivoLevaAoTeor('SEM_TEOR_NO_DATAJUD')).toBe(false);
    expect(motivoLevaAoTeor('ANDAMENTO_ANTIGO')).toBe(false);
    expect(motivoLevaAoTeor(null)).toBe(false);
  });
});

/**
 * A DISPENSA DE GENTE TEM NOME E DATA.
 *
 * Marcar "já cuidei" e a tela ficar igual seria o mesmo silêncio de antes com
 * outra roupa: quem abre a ficha depois precisa saber se aquele ato foi
 * resolvido por alguém ou se o sistema resolveu sozinho.
 */
describe('a frase de "já cuidei"', () => {
  const em = '2026-09-17T12:00:00.000Z';

  it('nomeia quem decidiu — e diz "por você" para quem clicou', () => {
    const frase = fraseJaCuidei({ dispensadoEm: em, dispensadoPor: 'u1' }, 'u1');
    expect(frase).toContain('por você');
    expect(frase).toContain('17/09/2026');
  });

  it('para os demais, a decisão é da equipe', () => {
    expect(fraseJaCuidei({ dispensadoEm: em, dispensadoPor: 'u2' }, 'u1')).toContain('pela equipe');
  });

  it('o motivo entra quando houver', () => {
    const frase = fraseJaCuidei(
      { dispensadoEm: em, dispensadoPor: 'u1', dispensadoMotivo: 'o prazo é da outra parte' },
      'u1',
    );
    expect(frase).toContain('o prazo é da outra parte');
  });

  /**
   * SEM AUTOR NÃO É DECISÃO DE GENTE. Por algumas horas em 17/09/2026 o robô
   * carimbou as colunas de dispensa humana, sem autor, e apagou o selo âmbar de
   * o andamento. A tela nunca pode ler aquilo como "alguém cuidou".
   */
  it('carimbo sem autor não vira "alguém cuidou"', () => {
    expect(fraseJaCuidei({ dispensadoEm: em, dispensadoPor: null }, 'u1')).toBeNull();
    expect(fraseJaCuidei({ dispensadoEm: null, dispensadoPor: 'u1' }, 'u1')).toBeNull();
    expect(fraseJaCuidei({}, 'u1')).toBeNull();
  });
});

/**
 * A FICHA É ONDE A DECISÃO ACONTECE — aba Linha do Tempo, no próprio cartão do
 * andamento. Antes, agir sobre um ato exigia abrir a Agenda e digitar tudo de
 * novo: quatro telas para uma decisão de um segundo.
 */
describe('a ficha do processo oferece as duas mãos', () => {
  const ITEM = FICHA.slice(FICHA.indexOf('function ItemLinhaTempo('));

  it('os dois botões existem no cartão do andamento', () => {
    expect(ITEM).toContain('Virar tarefa');
    expect(ITEM).toContain('Já cuidei');
    expect(ITEM).toContain('onClick={onVirarTarefa}');
    expect(ITEM).toContain('onClick={onJaCuidei}');
  });

  /**
   * Mobile-first: área de toque de 44px nos DOIS botões, e coluna no celular.
   *
   * Ancorar no comentário deixava o teste verde se os 44px saíssem dos botões —
   * aqui ele CONTA, dentro do bloco que só existe quando o ato pede atenção.
   */
  it('cabem no dedo e na tela de 400px', () => {
    const inicio = ITEM.indexOf('pedeAtencao && podeAgir ? (');
    const bloco = ITEM.slice(inicio, ITEM.indexOf(') : null}', inicio));
    expect(bloco.match(/min-h-\[44px\]/g)).toHaveLength(2);
    expect(bloco).toContain('flex flex-col gap-2 sm:flex-row');
  });

  /**
   * O CONVITE FICA AO LADO DA MÃO. A frase do carimbo aparece em cartão que não
   * tem botão nenhum (código fora do dicionário, ato de mais de 30 dias, perfil
   * sem edição na Agenda) — mandar apertar o que não está na tela é a mesma
   * desconfiança por outro caminho.
   */
  it('a frase do robô explica e não manda apertar botão', () => {
    for (const motivo of ['SEM_TEOR_NO_DATAJUD', 'ANDAMENTO_ANTIGO'] as const) {
      const frase = fraseSemTarefa(motivo) ?? '';
      expect(frase).toContain('O robô não abriu tarefa');
      expect(frase).not.toContain('Virar tarefa');
      expect(frase).not.toContain('marque na Agenda');
    }
    // E o convite existe, dentro do bloco dos botões.
    const inicio = ITEM.indexOf('pedeAtencao && podeAgir ? (');
    expect(ITEM.slice(inicio, ITEM.indexOf(') : null}', inicio))).toContain('Se já resolveu, marque como cuidado.');
  });

  /** O "já cuidei" tem volta — no aviso e dentro da faixa verde do cartão. */
  it('"Já cuidei" pode ser desfeito', () => {
    expect(FICHA).toContain('desfazerJaCuideiDoAndamento(movId)');
    expect(FICHA).toContain("action: { label: 'Desfazer'");
    expect(ITEM).toContain('onClick={onDesfazerCuidado}');
  });

  /**
   * Só nos atos que PEDEM atenção, e quem decide isso é o servidor. Dois botões
   * em cada um dos 3.018 andamentos do acervo seriam ruído para atender 27.
   */
  it('só aparecem no ato que ainda pede providência, e a régua vem do servidor', () => {
    expect(FICHA).toContain('acionaveis.has(item.id)');
    expect(FICHA).toContain('p?.atencao?.idsAcionaveis');
  });

  /** Criar atividade é escrita na AGENDA: sem os dois módulos, a API recusaria. */
  it('"Virar tarefa" só para quem grava na Agenda', () => {
    expect(FICHA).toContain("nivelEfetivo(user?.role, user?.permissoes, 'agenda') === 'EDITAR'");
    expect(ITEM).toContain('{podeAgendar && (');
  });

  /** Depois de virar tarefa, a tela leva à atividade em vez de oferecer de novo. */
  it('com atividade criada, o cartão vira atalho para a Agenda', () => {
    expect(ITEM).toContain('href={`/agenda?compromisso=${item.compromissoId}`}');
    expect(ITEM).toContain('Abrir a atividade na Agenda');
    expect(ITEM).toContain('{item.compromissoId ? (');
  });

  /** E quem já cuidou aparece nomeado, no lugar dos botões. */
  it('a dispensa de gente ocupa o lugar dos botões', () => {
    expect(ITEM).toContain('fraseJaCuidei(item, usuarioId)');
  });

  /**
   * UM CAMINHO SÓ ATÉ O TEOR. O link inline duplicava o botão vizinho: mesma
   * publicação, mesmo clique, nomes diferentes — e o botão ainda diz a
   * providência. Dois controles colados para o mesmo destino é pergunta que a
   * tela não devia fazer.
   */
  it('o teor tem um caminho só, e ele diz a providência', () => {
    expect(ITEM.match(/onVerPublicacao\(item\.publicacao!\.id\)/g)).toHaveLength(1);
    expect(ITEM).toContain('Ver teor no DJEN');
    expect(ITEM).toContain('PROVIDENCIA_LABEL[item.publicacao.providencia]');
  });

  /** "Já cuidei" pergunta o porquê e aceita o silêncio — e não é exclusão. */
  it('o diálogo do "já cuidei" pede motivo opcional e não é destrutivo', () => {
    const dialogo = FICHA.slice(FICHA.indexOf('open={!!andamentoParaCuidar}'));
    expect(dialogo.slice(0, 1200)).toContain('Por quê? (opcional)');
    expect(dialogo.slice(0, 1200)).not.toContain('variant="destructive"');
  });
});
