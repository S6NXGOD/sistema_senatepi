const get = jest.fn();
jest.mock('./api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

import { QueryClient } from '@tanstack/react-query';
import { consultaDaPreviaDoLink } from './filiados';

/**
 * A CONSULTA DA PRÉVIA DO LINK — com um QueryClient de verdade (15/09/2026).
 *
 * O teste anterior conferia com `toContain` que a linha da chave existia no
 * componente. Isso não prova o que importa: que gravar CPF ou data na ficha
 * (invalidar ['filiado', id]) refaz a prévia, e que a ficha de OUTRO filiado
 * não mexe nela.
 */
describe('consultaDaPreviaDoLink', () => {
  beforeEach(() => get.mockReset());

  it('pergunta a rota da prévia do filiado certo', async () => {
    get.mockResolvedValue({ data: { desafio: 'CPF', podeGerar: true, motivo: null, cpfGravadoInvalido: false } });
    const qc = new QueryClient();
    const r = await qc.fetchQuery(consultaDaPreviaDoLink('f-maria'));
    expect(get).toHaveBeenCalledWith('/filiados/f-maria/link-recadastramento/previa');
    expect(r).toEqual({ desafio: 'CPF', podeGerar: true, motivo: null, cpfGravadoInvalido: false });
  });

  it('invalidar a ficha do filiado invalida a prévia; a de outro filiado, não', async () => {
    get.mockResolvedValue({ data: { desafio: 'NENHUM', podeGerar: false } });
    const qc = new QueryClient();
    await qc.fetchQuery(consultaDaPreviaDoLink('f-maria'));
    await qc.fetchQuery(consultaDaPreviaDoLink('f-joao'));

    await qc.invalidateQueries({ queryKey: ['filiado', 'f-maria'] });

    expect(qc.getQueryState(consultaDaPreviaDoLink('f-maria').queryKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(consultaDaPreviaDoLink('f-joao').queryKey)?.isInvalidated).toBe(false);
  });

  /** Na janela de troca a rota pode não existir: um 404 não pode virar três. */
  it('não repete o pedido que falhou e nunca serve resposta velha', async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    const qc = new QueryClient();
    await expect(qc.fetchQuery(consultaDaPreviaDoLink('f-ana'))).rejects.toEqual({ response: { status: 404 } });
    expect(get).toHaveBeenCalledTimes(1);
    expect(consultaDaPreviaDoLink('f-ana').staleTime).toBe(0);
  });
});
