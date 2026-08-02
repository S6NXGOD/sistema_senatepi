'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Receipt, Settings2, Users, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FiliadosCobrancasTab } from '@/components/cobrancas/filiados-cobrancas-tab';
import { ContribuicoesPatronaisTab } from '@/components/cobrancas/contribuicoes-patronais-tab';
import { listarContribuicoesAdmin } from '@/lib/contribuicoes-patronais';

/**
 * Cobranças — duas frentes de arrecadação sob a mesma tela:
 *  • Filiados: carnês e parcelas (fluxo que já existia, intacto);
 *  • Empresas: conferência das contribuições patronais declaradas no portal.
 */
export default function CobrancasPage() {
  const [aba, setAba] = useState('filiados');

  // Só para o contador na aba — mostra à equipe que há fila esperando.
  const { data: patronais } = useQuery({
    queryKey: ['contribuicoes-patronais', 'EM_ANALISE', '', 1],
    queryFn: () => listarContribuicoesAdmin({ status: 'EM_ANALISE', page: 1, pageSize: 20 }),
  });
  const pendentes = patronais?.resumo.emAnalise ?? 0;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <Receipt className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Cobranças</h2>
            <p className="text-sm text-muted-foreground">
              {aba === 'filiados'
                ? 'Carnês e parcelas por filiado'
                : 'Contribuições declaradas pelas empresas'}
            </p>
          </div>
        </div>
        {/* As ações são do fluxo de filiados; somem na aba de empresas, onde a
            guia é gerada pela própria empresa no portal. */}
        {aba === 'filiados' && (
          <div className="flex items-center gap-2">
            <Link href="/cobrancas/configuracao">
              <Button variant="outline"><Settings2 className="h-4 w-4" /> Configuração</Button>
            </Link>
            <Link href="/cobrancas/nova">
              <Button><Plus className="h-4 w-4" /> Nova cobrança</Button>
            </Link>
          </div>
        )}
      </div>

      <Tabs value={aba} onValueChange={setAba} className="space-y-6">
        <TabsList>
          <TabsTrigger value="filiados">
            <Users className="h-4 w-4" /> Filiados
          </TabsTrigger>
          <TabsTrigger value="empresas">
            <Building2 className="h-4 w-4" /> Empresas
            {pendentes > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {pendentes}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="filiados">
          <FiliadosCobrancasTab />
        </TabsContent>

        <TabsContent value="empresas">
          <ContribuicoesPatronaisTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
