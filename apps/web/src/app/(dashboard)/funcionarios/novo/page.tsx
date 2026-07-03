'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FuncionarioForm } from '@/components/funcionarios/funcionario-form';

export default function NovoFuncionarioPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/funcionarios" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold">Novo funcionário</h2>
          <p className="text-sm text-muted-foreground">Preencha os dados do colaborador</p>
        </div>
      </div>
      <FuncionarioForm />
    </div>
  );
}
