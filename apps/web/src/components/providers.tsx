'use client';

import { useState, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { AvisoNovaVersao } from '@/components/avisos/nova-versao';
import { IdentidadeProvider } from '@/components/identidade-provider';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={client}>
        {/* Dentro do QueryClient e FORA do AuthProvider: a marca precisa
            valer também na tela de login, onde ninguém está autenticado. */}
        <IdentidadeProvider>
          <AuthProvider>{children}</AuthProvider>
        </IdentidadeProvider>
        {/* Fora do AuthProvider de propósito: a atualização precisa ser
            oferecida também na tela de login, onde ninguém está autenticado. */}
        <AvisoNovaVersao />
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
