import { useQuery } from '@tanstack/react-query';
import { listarTiposEvento } from './agenda';

/** Tipos de evento da Agenda (cacheados). Compartilhado por card/form/filtro/etc. */
export function useTiposEvento(incluirInativos = false) {
  const q = useQuery({
    queryKey: ['tipos-evento', incluirInativos],
    queryFn: () => listarTiposEvento(incluirInativos),
    staleTime: 60_000,
  });
  return { tipos: q.data ?? [], isLoading: q.isLoading };
}
