'use client';

import { useState } from 'react';
import { Landmark, X } from 'lucide-react';
import { BuscaSelect, type ItemBusca } from '@/components/ui/busca-select';
import { buscarEntes, type EnteResumido } from '@/lib/municipios';

/**
 * QUEM RESPONDE PELO ORÇAMENTO DESTA ORGANIZAÇÃO.
 *
 * POR QUE ISTO PRECISA DE GENTE. A varredura da madrugada só liga o que o NOME
 * prova ("MUNICÍPIO DE CORRENTE", "ESTADO DO PIAUÍ") — 21 das 77 organizações da
 * produção. As outras 56 são hospitais, clínicas e cooperativas cujo nome não
 * diz nada sobre o orçamento: o Hospital Getúlio Vargas fica em Teresina e quem
 * paga a folha dele é o Estado do Piauí. Não há texto no cadastro que prove
 * isso; há alguém no sindicato que sabe.
 *
 * Escolher aqui carimba a ligação como MANUAL, e a partir daí nenhuma varredura
 * encosta nela. É o mesmo contrato da caixa de propostas: o robô sugere o que
 * consegue provar, a pessoa decide o resto, e a decisão dela não é desfeita.
 *
 * ATRAVESSA AS TRÊS ESFERAS de propósito — digitar "piauí" tem de achar o
 * Governo do Estado, e não só os municípios cujo nome contém a palavra.
 */
export function SeletorDeEnte({
  valor,
  onEscolher,
}: {
  valor: EnteResumido | null;
  onEscolher: (ente: EnteResumido | null) => void;
}) {
  const [trocando, setTrocando] = useState(false);

  const nomeCompleto = (e: EnteResumido) =>
    e.esfera === 'M'
      ? `Município de ${e.nome}`
      : e.esfera === 'E'
        ? `Governo do Estado — ${e.nome}`
        : e.nome;

  async function procurar(termo: string): Promise<ItemBusca[]> {
    const achados = await buscarEntes(termo);
    return achados.map((e) => ({
      id: String(e.codigo),
      rotulo: nomeCompleto(e),
      detalhe: e.esfera === 'M' ? e.uf : null,
      marca: e.esfera === 'E' ? 'estado' : e.esfera === 'U' ? 'união' : null,
    }));
  }

  if (valor && !trocando) {
    return (
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Ente público responsável</label>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">{nomeCompleto(valor)}</span>
          <button
            type="button"
            onClick={() => setTrocando(true)}
            className="shrink-0 text-xs font-semibold text-brand-800 hover:underline dark:text-brand-400"
          >
            trocar
          </button>
          <button
            type="button"
            onClick={() => onEscolher(null)}
            aria-label="Remover o ente"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-red-600 sm:h-8 sm:w-8"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Ente público responsável</label>
      <BuscaSelect
        onBuscar={procurar}
        onEscolher={(item) => {
          /*
            O rótulo é remontado a partir do que a busca devolveu; o que importa
            gravar é o CÓDIGO. Nome de município não identifica município no
            Brasil — 240 se repetem entre estados.
          */
          onEscolher({
            codigo: Number(item.id),
            nome: item.rotulo.replace(/^(Município de |Governo do Estado — )/, ''),
            uf: item.detalhe ?? '',
            esfera: item.marca === 'estado' ? 'E' : item.marca === 'união' ? 'U' : 'M',
          });
          setTrocando(false);
        }}
        placeholder="Prefeitura, Governo do Estado, União…"
        rodape="Quem paga a folha desta organização. O Hospital Getúlio Vargas fica em Teresina e quem responde por ele é o Estado — por isso o endereço não serve de resposta."
      />
      {trocando && (
        <button
          type="button"
          onClick={() => setTrocando(false)}
          className="text-xs text-muted-foreground hover:underline"
        >
          cancelar a troca
        </button>
      )}
    </div>
  );
}
