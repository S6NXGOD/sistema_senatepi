'use client';

import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';

/**
 * QUEM PODE INCLUIR ALGUÉM NO CADASTRO.
 *
 * O advogado tem `filiados: VISUALIZAR` e a API recusa o `POST /filiados` para
 * ele — a fronteira é do balcão, e é boa: esta base já tem uma pessoa
 * cadastrada sete vezes. Os chamadores usam isto para não OFERECER o caminho;
 * o formulário e a API continuam checando por conta própria, porque botão
 * escondido não é autorização.
 */
export function usePodeCadastrarFiliado(): boolean {
  const { user } = useAuth();
  return podeEditar(user?.role, user?.permissoes, 'filiados');
}
