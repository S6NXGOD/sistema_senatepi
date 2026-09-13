'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Carregando, Esqueleto } from '@/components/ui/esqueleto';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { ColaboradorForm } from '@/components/colaboradores/colaborador-form';
import { getColaborador } from '@/lib/colaboradores';

export default function EditarColaboradorPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['colaborador', id], queryFn: () => getColaborador(id) });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/colaboradores" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <h2 className="text-2xl font-bold">Editar colaborador</h2>
      </div>
      {/* 13/09/2026: só sem dado. Uma revalidação que falha (ao voltar para a
          aba, na janela do deploy) liga isError e GUARDA o data; trocar o
          formulário pela falha desmontava o useForm e apagava o que foi digitado. */}
      {isError && !data ? (
        <FalhaAoCarregar erro={error} oQue="o cadastro do colaborador" onTentarDeNovo={() => refetch()} />
      ) : isLoading || !data ? (
        <Carregando texto="Carregando o cadastro…" className="space-y-4">
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-10 w-3/4" />
          <Esqueleto className="h-40 w-full" />
        </Carregando>
      ) : (
        <ColaboradorForm inicial={data} />
      )}
    </div>
  );
}
