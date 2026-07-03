'use client';

import { useQuery } from '@tanstack/react-query';
import { X, Printer, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function QrCodeDialog({
  funcionarioId,
  onClose,
}: {
  funcionarioId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['funcionario-qr', funcionarioId],
    queryFn: async () => (await api.get(`/funcionarios/${funcionarioId}/qrcode`)).data,
  });

  function imprimir() {
    if (!data?.imagem) return;
    const win = window.open('', '_blank', 'width=400,height=500');
    if (!win) return;
    win.document.write(
      `<html><head><title>QR Code</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
       <img src="${data.imagem}" style="width:320px" onload="window.print();window.close()" /></body></html>`,
    );
    win.document.close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">QR Code de identificação</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-col items-center gap-4">
          {isLoading ? (
            <Loader2 className="h-8 w-8 animate-spin text-senatepi-800" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data?.imagem} alt="QR Code" className="h-64 w-64" />
          )}
          <Button onClick={imprimir} disabled={!data} className="w-full">
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
        </div>
      </div>
    </div>
  );
}
