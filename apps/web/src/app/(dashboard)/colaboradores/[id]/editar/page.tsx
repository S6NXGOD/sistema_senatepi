'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ColaboradorForm } from '@/components/colaboradores/colaborador-form';
import { getColaborador } from '@/lib/colaboradores';

export default function EditarColaboradorPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({ queryKey: ['colaborador', id], queryFn: () => getColaborador(id) });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/colaboradores" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <h2 className="text-2xl font-bold">Editar colaborador</h2>
      </div>
      {isLoading || !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>
      ) : (
        <ColaboradorForm inicial={data} />
      )}
    </div>
  );
}
