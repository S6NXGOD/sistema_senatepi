'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ColaboradorForm } from '@/components/colaboradores/colaborador-form';

export default function NovoColaboradorPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/colaboradores" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <h2 className="text-2xl font-bold">Novo colaborador</h2>
      </div>
      <ColaboradorForm />
    </div>
  );
}
