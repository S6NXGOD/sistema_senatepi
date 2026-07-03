import { Construction } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function EmConstrucao({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{titulo}</h2>
        <p className="text-sm text-muted-foreground">{descricao}</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="rounded-2xl bg-senatepi-50 p-4 dark:bg-senatepi-900/30">
            <Construction className="h-10 w-10 text-senatepi-800" />
          </div>
          <p className="text-lg font-semibold">Módulo em construção</p>
          <p className="max-w-md text-sm text-muted-foreground">
            A API deste módulo já está disponível. A interface será entregue na próxima
            iteração, seguindo o mesmo padrão visual das telas já prontas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
