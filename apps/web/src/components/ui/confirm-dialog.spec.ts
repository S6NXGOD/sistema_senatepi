import { aoTeclarNoDialogo, travasDoDialogo } from './confirm-dialog';

/*
  ESC NO DIÁLOGO DE CONFIRMAÇÃO (15/09/2026).

  O "Reabrir" aberto pela gaveta do atendimento não ouvia o Esc; a gaveta
  embaixo ouvia no `document` e fechava inteira, deixando o diálogo na tela. O
  diálogo agora escuta na captura da `window` e para o evento ali. O jest do web
  roda sem navegador: o teste chama o tratador com um evento falso.
*/
function evento(key: string) {
  const parado = { valor: false };
  const impedido = { valor: false };
  return {
    ev: {
      key,
      stopPropagation: () => { parado.valor = true; },
      preventDefault: () => { impedido.valor = true; },
    },
    parado,
    impedido,
  };
}

describe('o Esc do ConfirmDialog', () => {
  it('fecha o diálogo e não deixa o Esc chegar à gaveta embaixo', () => {
    const { ev, parado } = evento('Escape');
    const fechou: string[] = [];
    aoTeclarNoDialogo(ev, { loading: false, onClose: () => fechou.push('diálogo') });
    expect(fechou).toEqual(['diálogo']);
    expect(parado.valor).toBe(true);
  });

  it('gravando, não fecha, e mesmo assim a gaveta não fecha', () => {
    const { ev, parado } = evento('Escape');
    const fechou: string[] = [];
    aoTeclarNoDialogo(ev, { loading: true, onClose: () => fechou.push('diálogo') });
    expect(fechou).toEqual([]);
    expect(parado.valor).toBe(true);
  });

  it('outra tecla passa direto', () => {
    const { ev, parado } = evento('Enter');
    const fechou: string[] = [];
    aoTeclarNoDialogo(ev, { loading: false, onClose: () => fechou.push('diálogo') });
    expect(fechou).toEqual([]);
    expect(parado.valor).toBe(false);
  });
});

/*
  CONFERINDO NÃO É GRAVANDO (15/09/2026). O excluir das escalas passava a
  conferência das consultas como `loading`: o Cancelar travava junto, e quem
  abriu o diálogo por engano esperava a rede para desistir.
*/
describe('as travas dos botões do ConfirmDialog', () => {
  it('conferindo: só o confirmar trava; Cancelar continua', () => {
    expect(travasDoDialogo({ loading: false, confirmDisabled: true })).toEqual({ confirmar: true, cancelar: false });
  });

  it('gravando: os dois travam, com ou sem conferência', () => {
    expect(travasDoDialogo({ loading: true, confirmDisabled: false })).toEqual({ confirmar: true, cancelar: true });
    expect(travasDoDialogo({ loading: true, confirmDisabled: true })).toEqual({ confirmar: true, cancelar: true });
  });

  it('sem nenhuma das duas (os usos de antes da prop): nada trava', () => {
    expect(travasDoDialogo({ loading: false, confirmDisabled: false })).toEqual({ confirmar: false, cancelar: false });
  });
});

/*
  ENTER CONFIRMA — E SÓ ONDE A AÇÃO TEM VOLTA (18/09/2026).

  A fila de cadastros duplicados é trabalho repetitivo: dezenas de grupos, a
  mesma decisão em cada um. O relato foi "está praticamente invisível e ao
  clicar vai diretamente executando a ação" — o conserto foi perguntar antes,
  e perguntar sem atrapalhar exige que a resposta caiba numa tecla.

  A linha que separa é o preço do engano: "não é a mesma pessoa" volta pelo
  Desfazer e pela lista; consolidar APAGA cadastro. Por isso a opção é de quem
  chama, e o padrão é NÃO ter o atalho.
*/
describe('o Enter do ConfirmDialog', () => {
  it('confirma quando o diálogo pediu o atalho', () => {
    const { ev, parado, impedido } = evento('Enter');
    const feito: string[] = [];
    aoTeclarNoDialogo(ev, {
      loading: false,
      onClose: () => feito.push('fechou'),
      confirmarComEnter: true,
      onConfirm: () => feito.push('confirmou'),
    });
    expect(feito).toEqual(['confirmou']);
    // Para o evento: a tela de trás também escuta Enter (o modo foco abre a
    // consolidação com ele) e confirmaria duas coisas de uma tecla só.
    expect(parado.valor).toBe(true);
    expect(impedido.valor).toBe(true);
  });

  /** O padrão continua o de sempre: Enter não decide nada. */
  it('sem o atalho, Enter passa direto — inclusive no diálogo que APAGA', () => {
    const { ev, parado } = evento('Enter');
    const feito: string[] = [];
    aoTeclarNoDialogo(ev, {
      loading: false,
      onClose: () => feito.push('fechou'),
      onConfirm: () => feito.push('confirmou'),
    });
    expect(feito).toEqual([]);
    expect(parado.valor).toBe(false);
  });

  it('gravando, o Enter não reenvia', () => {
    const { ev } = evento('Enter');
    const feito: string[] = [];
    aoTeclarNoDialogo(ev, {
      loading: true,
      onClose: () => {},
      confirmarComEnter: true,
      onConfirm: () => feito.push('confirmou'),
    });
    expect(feito).toEqual([]);
  });

  /** E respeita a trava de "ainda não dá para confirmar". */
  it('com o confirmar travado, o Enter não atropela a trava', () => {
    const { ev } = evento('Enter');
    const feito: string[] = [];
    aoTeclarNoDialogo(ev, {
      loading: false,
      onClose: () => {},
      confirmarComEnter: true,
      confirmDisabled: true,
      onConfirm: () => feito.push('confirmou'),
    });
    expect(feito).toEqual([]);
  });

  /** O Esc continua fechando, com ou sem o atalho novo. */
  it('o Esc não mudou', () => {
    const { ev } = evento('Escape');
    const feito: string[] = [];
    aoTeclarNoDialogo(ev, {
      loading: false,
      onClose: () => feito.push('fechou'),
      confirmarComEnter: true,
      onConfirm: () => feito.push('confirmou'),
    });
    expect(feito).toEqual(['fechou']);
  });
});
