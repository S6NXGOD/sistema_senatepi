import { ColoniaPublica } from '@/components/colonia/colonia-publica';

// Página pública de uma campanha específica pelo slug (link público).
export default async function ColoniaSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ColoniaPublica slug={slug} />;
}
