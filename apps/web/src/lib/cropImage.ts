export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.src = src;
  });
}

/**
 * Recorta a imagem segundo a área (em pixels) retornada pelo react-easy-crop
 * e devolve um Blob WebP pronto para upload.
 */
export async function recortarImagem(src: string, area: Area): Promise<Blob> {
  const img = await carregarImagem(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas não suportado');

  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar imagem'))),
      'image/webp',
      0.9,
    );
  });
}
