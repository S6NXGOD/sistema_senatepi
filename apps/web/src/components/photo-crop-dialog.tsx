'use client';

import { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';
import { Loader2, ZoomIn, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { recortarImagem, Area } from '@/lib/cropImage';

/**
 * Diálogo de recorte de foto. Recebe o arquivo selecionado, deixa o usuário
 * posicionar/ampliar dentro da proporção de retrato (3:4) e devolve um Blob
 * recortado — usado tanto no perfil quanto na carteirinha.
 */
export function PhotoCropDialog({
  arquivo,
  aspect = 3 / 4,
  onConfirm,
  onClose,
}: {
  arquivo: File;
  aspect?: number;
  onConfirm: (blob: Blob) => void;
  onClose: () => void;
}) {
  const [src] = useState(() => URL.createObjectURL(arquivo));
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [processando, setProcessando] = useState(false);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setArea(areaPixels);
  }, []);

  async function confirmar() {
    if (!area) return;
    setProcessando(true);
    try {
      const blob = await recortarImagem(src, area);
      onConfirm(blob);
    } finally {
      setProcessando(false);
      URL.revokeObjectURL(src);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Ajustar foto</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="relative h-80 w-full overflow-hidden rounded-lg bg-muted">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            cropShape="rect"
            showGrid
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <ZoomIn className="h-4 w-4 text-muted-foreground" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-senatepi-800"
          />
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={processando}>
            {processando && <Loader2 className="h-4 w-4 animate-spin" />}
            Aplicar recorte
          </Button>
        </div>
      </div>
    </div>
  );
}
