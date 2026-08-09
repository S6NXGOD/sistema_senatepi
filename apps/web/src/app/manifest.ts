import type { MetadataRoute } from 'next';
import { tenant } from '@/tenant.config';

/**
 * MANIFEST DO PWA — gerado, não escrito à mão.
 *
 * Era um arquivo estático em `/public` com "SENATEPI" no nome, na descrição, na
 * cor e no ícone. Instalar o aplicativo de outro sindicato instalaria um app
 * chamado SENATEPI, verde, na tela inicial do celular do filiado dele.
 *
 * O ícone segue a convenção dos logos: `<id-do-cliente>-icone.png` em
 * `/public`. Ele NÃO cai para outro arquivo se faltar — o navegador
 * simplesmente usa o ícone padrão dele, que é melhor do que exibir a marca do
 * sindicato errado.
 */
export default function manifest(): MetadataRoute.Manifest {
  const icone = `/${tenant.id}-icone.png`;
  return {
    name: `${tenant.sigla} — Gestão Sindical`,
    short_name: tenant.sigla,
    description: `Sistema de gestão do ${tenant.descricao}`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: tenant.paleta[800],
    icons: [
      { src: icone, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icone, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
