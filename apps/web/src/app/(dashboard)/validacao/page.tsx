'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, ScanLine, Camera, CameraOff } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Resultado {
  liberado: boolean;
  motivo: string;
  duplicada: boolean;
  pessoa: { tipo: string; nome: string; fotoUrl: string | null };
}

export default function ValidacaoPage() {
  const [eventoId, setEventoId] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [escaneando, setEscaneando] = useState(false);
  const scannerRef = useRef<any>(null);

  const { data: eventos } = useQuery({
    queryKey: ['eventos-validacao'],
    queryFn: async () => (await api.get('/eventos')).data,
  });

  async function validarPayload(texto: string) {
    try {
      const payload = JSON.parse(texto);
      const { data } = await api.post<Resultado>('/validacao/qr', {
        payload,
        eventoId: eventoId || undefined,
      });
      setResultado(data);
    } catch {
      setResultado({
        liberado: false,
        motivo: 'QR Code ilegível ou inválido',
        duplicada: false,
        pessoa: { tipo: '', nome: 'Desconhecido', fotoUrl: null },
      });
    }
  }

  // Inicializa o leitor por webcam (html5-qrcode) sob demanda.
  useEffect(() => {
    if (!escaneando) return;
    let ativo = true;
    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (texto: string) => {
            if (ativo) validarPayload(texto);
          },
          () => undefined,
        );
      } catch {
        setEscaneando(false);
      }
    })();
    return () => {
      ativo = false;
      scannerRef.current?.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escaneando, eventoId]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Validação de acesso</h2>
        <p className="text-sm text-muted-foreground">
          Leia o QR Code (webcam, leitor USB ou celular) para validar a entrada
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            value={eventoId}
            onChange={(e) => setEventoId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">— Apenas consultar (sem registrar presença) —</option>
            {eventos?.map((e: any) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>

          {/* Leitor USB: foca um input invisível que recebe o texto e dispara no Enter */}
          <input
            autoFocus
            placeholder="Foque aqui e use o leitor USB, ou cole o conteúdo do QR..."
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                validarPayload((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />

          <Button variant={escaneando ? 'destructive' : 'secondary'} onClick={() => setEscaneando((s) => !s)}>
            {escaneando ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
            {escaneando ? 'Parar webcam' : 'Usar webcam'}
          </Button>

          <div id="qr-reader" className={escaneando ? 'overflow-hidden rounded-lg border' : 'hidden'} />
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {resultado && (
          <motion.div
            key={resultado.pessoa.nome + resultado.motivo}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <Card className={resultado.liberado ? 'border-senatepi-600' : 'border-red-400'}>
              <CardContent className="flex items-center gap-6 p-6">
                {resultado.pessoa.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resultado.pessoa.fotoUrl} alt="" className="h-24 w-24 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted">
                    <ScanLine className="h-10 w-10 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-xs uppercase text-muted-foreground">{resultado.pessoa.tipo}</p>
                  <p className="text-xl font-bold">{resultado.pessoa.nome}</p>
                  <div className={`mt-2 flex items-center gap-2 text-lg font-semibold ${resultado.liberado ? 'text-senatepi-800' : 'text-red-600'}`}>
                    {resultado.liberado ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
                    {resultado.liberado ? 'Entrada liberada' : 'Entrada negada'}
                  </div>
                  <p className="text-sm text-muted-foreground">{resultado.motivo}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
