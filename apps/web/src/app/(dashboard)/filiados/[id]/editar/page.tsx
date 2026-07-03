'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { FiliadoForm } from '@/components/filiados/filiado-form';

export default function EditarFiliadoPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['filiado', id],
    queryFn: async () => (await api.get(`/filiados/${id}`)).data,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/filiados/${id}`} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h2 className="text-2xl font-bold">Editar filiado</h2>
          <p className="text-sm text-muted-foreground">{data?.nomeCompleto}</p>
        </div>
      </div>
      {isLoading || !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800" /></div>
      ) : (
        <FiliadoForm inicial={data} modo="editar" />
      )}
    </div>
  );
}
