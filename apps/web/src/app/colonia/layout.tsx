import { GateDeModulo } from '@/components/gate-de-modulo';

/**
 * A inscrição pública da colônia é a única rota de módulo que fica FORA do
 * administrativo — e por isso escapava do gate do dashboard.
 *
 * Ela é pública de verdade (o filiado se inscreve sem login), então numa
 * instalação sem colônia a página ficaria aberta na internet, chamando uma API
 * que responde 404. O gate a torna inexistente também aqui.
 */
export default function ColoniaPublicaLayout({ children }: { children: React.ReactNode }) {
  return <GateDeModulo>{children}</GateDeModulo>;
}
