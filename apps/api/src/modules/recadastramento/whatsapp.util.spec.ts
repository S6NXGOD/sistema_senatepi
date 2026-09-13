import { celularParaWhatsApp } from './whatsapp.util';

/**
 * A TABELA DE CASOS — cópia fiel de `apps/web/src/lib/whatsapp.spec.ts`.
 *
 * A rota de envio devolve `celularWhatsApp` e a tela habilita o botão por ele.
 * Se um caso mudar lá, tem de mudar aqui (e vice-versa).
 */
describe('celularParaWhatsApp (API) — um telefone', () => {
  const casos: Array<[string, string | null | undefined, string | null]> = [
    ['máscara da página pública', '(86) 99999-8888', '5586999998888'],
    ['só dígitos', '86999998888', '5586999998888'],
    ['com espaços e traço', '86 9 9999-8888', '5586999998888'],
    ['DDI com +', '+55 86 99999-8888', '5586999998888'],
    ['DDI sem +', '5586999998888', '5586999998888'],
    ['DDI com 00 na frente', '0055 86 99999-8888', '5586999998888'],
    ['zero na frente do DDD', '086 99999-8888', '5586999998888'],
    ['DDD 55 sem DDI (11 dígitos)', '(55) 99999-8888', '5555999998888'],
    ['DDD 55 com DDI (13 dígitos)', '+55 55 99999-8888', '5555999998888'],
    ['fixo com DDD', '(86) 3222-1111', null],
    ['fixo com DDI (12 dígitos)', '+55 86 3222-1111', null],
    ['celular antigo de 8 dígitos', '(86) 9999-8888', null],
    ['sem DDD', '99999-8888', null],
    ['11 dígitos sem o 9 na terceira posição', '86899998888', null],
    ['lixo', 'não tem', null],
    ['zero', '0', null],
    ['vazio', '', null],
    ['nulo', null, null],
    ['indefinido', undefined, null],
    ['dígitos demais', '5586999998888123', null],
  ];

  it.each(casos)('%s: %p → %p', (_nome, entrada, esperado) => {
    expect(celularParaWhatsApp(entrada)).toBe(esperado);
  });
});

describe('celularParaWhatsApp (API) — principal e secundário', () => {
  it('usa o secundário quando o principal é fixo', () => {
    expect(celularParaWhatsApp('(86) 3222-1111', '(86) 99999-8888')).toBe('5586999998888');
  });

  it('usa o secundário quando o principal está vazio', () => {
    expect(celularParaWhatsApp(null, '86999998888')).toBe('5586999998888');
    expect(celularParaWhatsApp('', '86999998888')).toBe('5586999998888');
  });

  it('prefere o principal quando os dois são celulares', () => {
    expect(celularParaWhatsApp('(86) 99999-1111', '(86) 99999-2222')).toBe('5586999991111');
  });

  it('nenhum dos dois é celular: null', () => {
    expect(celularParaWhatsApp('(86) 3222-1111', '(86) 3222-2222')).toBeNull();
    expect(celularParaWhatsApp()).toBeNull();
  });
});
