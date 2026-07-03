'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { FiliadoForm } from '@/components/filiados/filiado-form';

export default function RecadastrarFiliadoPage() {
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
          <h2 className="flex items-center gap-2 text-2xl font-bold"><RefreshCw className="h-5 w-5 text-senatepi-800" /> Recadastramento</h2>
          <p className="text-sm text-muted-foreground">
            Atualize os dados de {data?.nomeCompleto}. As alterações ficam registradas no histórico.
          </p>
        </div>
      </div>
      {isLoading || !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800" /></div>
      ) : (
        <FiliadoForm inicial={data} modo="recadastrar" />
      )}
    </div>
  );
}
