import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODAL = readFileSync(join(__dirname, 'importar-processo-dialog.tsx'), 'utf8');
const AGENDA = readFileSync(join(__dirname, '../../app/(dashboard)/agenda/page.tsx'), 'utf8');
const API = readFileSync(join(__dirname, '../../lib/api.ts'), 'utf8');

/**
 * "FICOU EM UM LOOP INFINITO" — relato de 12/09/2026, e eram TRÊS coisas.
 *
 * 1. Uma espera longa de verdade (a fila de cota do CNJ atendia o robô antes de
 *    quem estava na tela) — corrigido na API.
 * 2. Uma espera SEM RELÓGIO: a frase dizia "pode levar até 30s" e o cliente
 *    espera até 180s. Passados os 30, a tela repetia a mesma frase para sempre.
 * 3. Um giro genuinamente eterno: apagar um dígito do número durante a consulta
 *    deixava a bandeira `consultando` ligada sem nenhuma requisição no ar.
 */
describe('a espera tem relógio e tem fim', () => {
  it('todo caminho que sai do efeito desliga a bandeira', () => {
    const efeito = MODAL.slice(
      MODAL.indexOf('const digitos = (numeroDigitado'),
      MODAL.indexOf('}, [numeroDigitado, open, setValue, consultaImediata]);'),
    );
    // Três saídas: número incompleto, número já consultado, e o `finally`.
    expect(efeito.match(/setConsultando\(false\)/g) ?? []).toHaveLength(3);
  });

  it('a tela conta os segundos e para de prometer 30', () => {
    expect(MODAL).toContain('tabular-nums');
    expect(MODAL).toContain('{segundos}s');
    // A negativa mira o JSX: a frase antiga sobrevive no comentário que
    // explica por que ela saiu, e mirar prosa reprovaria o arquivo corrigido.
    expect(MODAL).not.toContain('DataJud (pode levar até 30s)');
  });

  it('e depois de um minuto oferece seguir sem esperar', () => {
    expect(MODAL).toContain('segundos >= 60');
    expect(MODAL).toContain('Você não precisa esperar');
  });

  /** A trava geral continua valendo — é ela que impede o esqueleto eterno. */
  it('o cliente HTTP tem prazo, e o longo é declarado caso a caso', () => {
    expect(API).toContain('const TIMEOUT_PADRAO_MS = 30_000;');
    expect(API).toContain('export const TIMEOUT_LONGO = 180_000;');
  });
});

/**
 * "O FILTRO DE BUSCA DA AGENDA NÃO ESTÁ BOM" — e não estava mesmo.
 *
 * Procurar "aval" com a aba **Hoje** ligada mostrava "1 filtro ativo · 0
 * atividades à vista" enquanto o calendário logo abaixo exibia quatro "Avaliar
 * recurso". Havia dois filtros; o que zerou a lista não se contava, não se
 * anunciava e não era solto por "Limpar filtros".
 */
describe('a aba da agenda é um filtro e assume isso', () => {
  it('entra na conta de filtros ativos', () => {
    expect(AGENDA).toContain("(aba !== 'todos' ? 1 : 0)");
  });

  it('"Limpar filtros" também solta a aba', () => {
    const fn = AGENDA.slice(AGENDA.indexOf('function limparFiltros()'));
    expect(fn.slice(0, 400)).toContain("setAba('todos')");
  });

  it('e quando a busca acha fora da aba, a tela diz onde e leva num toque', () => {
    expect(AGENDA).toContain('const foraDaAba');
    expect(AGENDA).toContain('em outras datas');
    expect(AGENDA).toContain("onClick={() => setAba('todos')}");
  });

  /** Só aparece quando resolve algo: com resultado na tela, seria ruído. */
  it('o atalho só surge quando a lista está vazia e há algo fora', () => {
    expect(AGENDA).toContain('foraDaAba > 0 && filtrados.length === 0');
  });
});

/**
 * O BECO SEM SAÍDA DO CADASTRO — a metade que mora na tela.
 *
 * A API deixou de recusar o processo que o CNJ ainda não indexou; sem a porta
 * na tela, ninguém saberia que ela existe. O texto antigo mandava "conferir o
 * número", que não era saída nenhuma quando o número estava certo.
 */
describe('quando o CNJ ainda não publicou, a tela oferece cadastrar', () => {
  it('a saída aparece e diz o que vai acontecer depois', () => {
    expect(MODAL).toContain('Cadastrar assim mesmo');
    expect(MODAL).toContain('quando o CNJ publicar');
  });

  it('e só vai para a API quando a pessoa marca', () => {
    expect(MODAL).toContain('...(semCnj ? { mesmoSemDatajud: true } : {})');
  });
});
