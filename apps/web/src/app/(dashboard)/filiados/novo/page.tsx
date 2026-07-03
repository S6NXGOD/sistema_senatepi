'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FiliadoForm } from '@/components/filiados/filiado-form';

export default function NovoFiliadoPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/filiados" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h2 className="text-2xl font-bold">Nova filiação</h2>
          <p className="text-sm text-muted-foreground">Preencha a ficha de filiação do associado</p>
        </div>
      </div>
      <FiliadoForm modo="criar" />
    </div>
  );
}
