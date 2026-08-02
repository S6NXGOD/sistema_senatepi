/**
 * As chaves que transformam um evento em assembleia, curso ou sorteio.
 *
 * POR QUE UM PARSER, E NÃO LER O JSON DIRETO
 * `Evento.configuracoes` é uma coluna JSON: aceita qualquer coisa. Ler
 * `config.exigeAdimplencia` direto do banco significa que uma chave escrita
 * errada — `exigeAdimplencia` virando `exigeAdimplencia` com acento, ou
 * `exige_adimplencia` — vira `undefined`, que é falsy, e o evento passa a
 * liberar todo mundo SEM ERRO NENHUM. Já aconteceu neste projeto: um DTO sem
 * `@ValidateNested` deixou `poloAtivo: {"tipo":"XPTO"}` passar e cair na
 * ramificação errada.
 *
 * Aqui todo acesso passa por `lerConfiguracoes`, que aplica os padrões e
 * descarta o que não reconhece. O default de cada chave é sempre o
 * comportamento MAIS PERMISSIVO em termos de entrada e o MENOS destrutivo em
 * termos de ação: um evento mal configurado deixa as pessoas entrarem (e a
 * secretaria conserta), em vez de barrar a assembleia inteira.
 */

export interface ConfiguracoesEvento {
  /**
   * Só entra quem está em dia com a contribuição.
   *
   * Padrão FALSO de propósito. A regra estatutária de quem vota é decisão da
   * diretoria, evento a evento — e 70% da base histórica sequer tem carnê
   * emitido. Ligar por padrão barraria quase todo mundo na primeira assembleia.
   */
  exigeAdimplencia: boolean;

  /** Habilita pautas e urna. Sem isso, o painel do plenário só mostra presença. */
  habilitarVotacao: boolean;

  /** Habilita o painel de sorteio ao vivo. */
  habilitarSorteio: boolean;

  /** Emite certificado por participante ao encerrar (modo "curso"). */
  gerarCertificado: boolean;

  /** Carga horária impressa no certificado. */
  cargaHoraria?: number;

  /**
   * Dependentes podem fazer check-in.
   *
   * Padrão FALSO: dependente não vota nem conta para quórum de assembleia.
   * Faz sentido em evento social, e é lá que se liga.
   */
  permiteDependente: boolean;

  /**
   * Quantos minutos antes do início o check-in abre.
   *
   * 60 por padrão: assembleia com quórum a apurar precisa de gente entrando
   * antes da hora, e abrir só no minuto do início cria fila.
   */
  checkinAbreMinutosAntes: number;

  /**
   * Quantos minutos depois do FIM o check-in ainda aceita entrada.
   *
   * 0 por padrão: presença registrada depois do encerramento é o tipo de coisa
   * que a parte contrária usa para anular a deliberação.
   */
  checkinFechaMinutosDepois: number;

  /** Texto livre exibido na tela de check-in (instruções, pauta do dia). */
  avisoCheckin?: string;
}

export const PADROES: ConfiguracoesEvento = {
  exigeAdimplencia: false,
  habilitarVotacao: false,
  habilitarSorteio: false,
  gerarCertificado: false,
  permiteDependente: false,
  checkinAbreMinutosAntes: 60,
  checkinFechaMinutosDepois: 0,
};

/** Chaves reconhecidas — o que vier fora disto é descartado na leitura. */
const CHAVES = Object.keys(PADROES) as (keyof ConfiguracoesEvento)[];

function ehBooleano(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function inteiroNaFaixa(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= min && i <= max ? i : null;
}

/**
 * Lê as configurações de um evento aplicando os padrões.
 *
 * Nunca lança: um evento com JSON corrompido precisa continuar abrindo — a
 * assembleia é hoje, e derrubar a tela porque uma chave veio errada troca um
 * problema pequeno por um grande. O que não for reconhecido volta ao padrão.
 */
export function lerConfiguracoes(bruto: unknown): ConfiguracoesEvento {
  const fonte = (bruto ?? {}) as Record<string, unknown>;
  const saida: ConfiguracoesEvento = { ...PADROES };

  for (const chave of CHAVES) {
    const valor = fonte[chave];
    if (valor === undefined || valor === null) continue;

    if (ehBooleano(PADROES[chave])) {
      if (ehBooleano(valor)) (saida[chave] as boolean) = valor;
      continue;
    }

    if (chave === 'checkinAbreMinutosAntes') {
      // Até 7 dias antes. Mais que isso não é "abrir cedo", é erro de digitação.
      const n = inteiroNaFaixa(valor, 0, 60 * 24 * 7);
      if (n !== null) saida.checkinAbreMinutosAntes = n;
      continue;
    }
    if (chave === 'checkinFechaMinutosDepois') {
      const n = inteiroNaFaixa(valor, 0, 60 * 24);
      if (n !== null) saida.checkinFechaMinutosDepois = n;
    }
  }

  // Opcionais, que não têm padrão.
  const carga = inteiroNaFaixa(fonte.cargaHoraria, 1, 1000);
  if (carga !== null) saida.cargaHoraria = carga;

  if (typeof fonte.avisoCheckin === 'string' && fonte.avisoCheckin.trim()) {
    saida.avisoCheckin = fonte.avisoCheckin.trim().slice(0, 1000);
  }

  return saida;
}

/**
 * Normaliza o que veio da tela ANTES de gravar.
 *
 * Grava só chaves conhecidas e já validadas: assim o banco nunca acumula
 * `{"habilitarVotacao": "sim"}` ou lixo de uma versão antiga da interface, e
 * quem abrir o registro entende o que está lá.
 */
export function normalizarConfiguracoes(bruto: unknown): ConfiguracoesEvento {
  return lerConfiguracoes(bruto);
}

/**
 * O check-in está aberto agora?
 *
 * Devolve o motivo junto porque "fechado" sem explicação gera ligação para a
 * secretaria no meio da assembleia — e quem está do outro lado não sabe se
 * errou o link, se chegou cedo ou se perdeu a hora.
 */
export function janelaCheckin(
  evento: { dataInicio: Date; dataFim: Date | null; status: string },
  cfg: ConfiguracoesEvento,
  agora = new Date(),
): { aberto: boolean; motivo: string } {
  if (evento.status === 'CANCELADO') {
    return { aberto: false, motivo: 'Este evento foi cancelado.' };
  }
  if (evento.status === 'REALIZADO') {
    return { aberto: false, motivo: 'Este evento já foi encerrado.' };
  }

  /**
   * EVENTO ABERTO PELA MESA VENCE O HORÁRIO AGENDADO.
   *
   * Antes esta função só olhava CANCELADO e REALIZADO e caía direto na janela
   * de horário — então um evento que a mesa tinha explicitamente aberto
   * continuava respondendo "o check-in abre 60 minutos antes do início" se a
   * data agendada ainda estivesse longe. O sistema contrariava quem o
   * comanda.
   *
   * A janela de horário existe para o caso comum: ninguém tocou em nada e o
   * evento acontece no horário previsto. Assim que alguém da mesa declara que
   * começou, a declaração é a verdade — assembleia atrasa, antecipa e é
   * remarcada em cima da hora, e o horário no cadastro não acompanha.
   */
  if (evento.status === 'EM_ANDAMENTO') {
    return { aberto: true, motivo: 'Check-in liberado — evento em andamento.' };
  }

  const abre = new Date(evento.dataInicio.getTime() - cfg.checkinAbreMinutosAntes * 60_000);
  if (agora < abre) {
    return {
      aberto: false,
      motivo: `O check-in abre ${cfg.checkinAbreMinutosAntes} minuto(s) antes do início.`,
    };
  }

  // Sem data de fim, o único limite é o encerramento manual do evento — é o
  // caso das assembleias, que não têm hora certa para acabar.
  if (evento.dataFim) {
    const fecha = new Date(evento.dataFim.getTime() + cfg.checkinFechaMinutosDepois * 60_000);
    if (agora > fecha) {
      return { aberto: false, motivo: 'O período de check-in já encerrou.' };
    }
  }

  return { aberto: true, motivo: 'Check-in liberado.' };
}
