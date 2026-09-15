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
  return { ev: { key, stopPropagation: () => { parado.valor = true; } }, parado };
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
