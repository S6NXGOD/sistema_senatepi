'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Panorama } from '@/lib/panorama';
import {
  ESCOLHAS_PADRAO_DO_PANORAMA, OPCOES_PADRAO_DO_PANORAMA, SECOES_DO_PANORAMA, gerarPdfDoPanorama,
  guardarEscolhasDoPanorama, guardarOpcoesDoPanorama, lerEscolhasDoPanorama, lerOpcoesDoPanorama,
  tituloPadraoDoPanorama, type EscolhasDoPanorama, type SecaoDoPanorama,
} from '@/lib/panorama-pdf';
import {
  DialogoDoPdf, Opcao, ParteDoDialogo, TituloEObservacao,
} from '@/components/relatorios/partes-do-pdf';

/**
 * O DIÁLOGO DO PDF DO PANORAMA — as mesmas peças dos Relatórios, sem período.
 *
 * "Personalizar" aqui é escolher seções, detalhe, gráficos, título e observação.
 * Não há recorte nem período para levar ao papel: o Panorama é o acervo de
 * agora, e os pisos (3 ações, 6 ações e 5 réus) foram calibrados no acervo
 * inteiro — num recorte, sobraria coincidência.
 *
 * SEM PERMISSÃO PRÓPRIA, de propósito: o papel imprime o que a tela já mostra a
 * quem a vê. Esconder o botão por perfil seria cosmético.
 */
export function PdfDoPanorama({
  panorama, emitidoPor, onFechar,
}: {
  panorama: Panorama;
  emitidoPor: string;
  onFechar: () => void;
}) {
  const [escolhas, setEscolhas] = useState<EscolhasDoPanorama>(() => lerEscolhasDoPanorama());
  const [graficos, setGraficos] = useState(() => lerOpcoesDoPanorama().graficos);
  const [titulo, setTitulo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [gerando, setGerando] = useState(false);

  const nenhumaSecao = !SECOES_DO_PANORAMA.some((s) => escolhas[s.chave].incluir);

  function alternar(chave: SecaoDoPanorama, campo: 'incluir' | 'detalhar') {
    setEscolhas((atual) => ({ ...atual, [chave]: { ...atual[chave], [campo]: !atual[chave][campo] } }));
  }

  function voltarAoPadrao() {
    setEscolhas(ESCOLHAS_PADRAO_DO_PANORAMA);
    setGraficos(OPCOES_PADRAO_DO_PANORAMA.graficos);
  }

  /** O que a seção tem HOJE — para ninguém descobrir no papel que ela saiu vazia. */
  function hojeTem(chave: SecaoDoPanorama): string {
    if (chave === 'lados') return `Hoje: ${panorama.acervoAtivo} processos ativos.`;
    const quantos = chave === 'concentracoes' ? panorama.concentracoes.length : panorama.dispersoes.length;
    if (!quantos) return 'Hoje não há nenhum: a seção sai dizendo isso.';
    if (chave === 'concentracoes') return `Hoje: ${quantos} ${quantos === 1 ? 'réu' : 'réus'}.`;
    return `Hoje: ${quantos} ${quantos === 1 ? 'pedido' : 'pedidos'}.`;
  }

  async function gerar() {
    setGerando(true);
    try {
      guardarEscolhasDoPanorama(escolhas);
      guardarOpcoesDoPanorama({ graficos });
      await gerarPdfDoPanorama(panorama, escolhas, { emitidoPor, titulo, observacao }, { graficos });
      onFechar();
    } catch {
      toast.error('Não foi possível gerar o PDF agora.');
    } finally {
      setGerando(false);
    }
  }

  return (
    <DialogoDoPdf
      titulo="PDF do panorama"
      subtitulo="Retrato de agora, com os números da tela. O Panorama não guarda histórico: não há período nem comparação."
      gerando={gerando}
      onFechar={onFechar}
      rodape={
        <>
          <button
            type="button"
            onClick={voltarAoPadrao}
            className="min-h-11 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Voltar ao padrão
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar} disabled={gerando}>
              Cancelar
            </Button>
            <Button onClick={gerar} disabled={gerando}>
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Gerar PDF
            </Button>
          </div>
        </>
      }
    >
      <ParteDoDialogo titulo="Seções">
        <p className="text-xs leading-snug text-muted-foreground">
          O aviso “Antes de ler” abre o PDF sempre: o que os números contam, que o sistema não opina
          sobre estratégia e que sentença não é resultado final.
        </p>
        <ul className="divide-y rounded-lg border">
          {SECOES_DO_PANORAMA.map((s) => {
            const escolha = escolhas[s.chave];
            return (
              <li key={s.chave} className="px-3 py-1.5">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={escolha.incluir}
                    onChange={() => alternar(s.chave, 'incluir')}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{s.resumo}</span>
                    <span className="block text-xs text-muted-foreground">{hojeTem(s.chave)}</span>
                  </span>
                </label>
                {s.detalhe && (
                  <label
                    className={cn(
                      'ml-7 flex min-h-11 cursor-pointer items-start gap-2 py-1.5 text-xs',
                      !escolha.incluir && 'pointer-events-none opacity-40',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={escolha.incluir && escolha.detalhar}
                      disabled={!escolha.incluir}
                      onChange={() => alternar(s.chave, 'detalhar')}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-700"
                    />
                    <span>
                      <span className="font-medium">Detalhar:</span> {s.detalhe}
                    </span>
                  </label>
                )}
                {s.cuidado && (
                  <p
                    className={cn(
                      'mb-1.5 ml-7 text-xs leading-snug',
                      escolha.incluir ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                    )}
                  >
                    {s.cuidado}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {nenhumaSecao && (
          <p className="text-xs text-muted-foreground">
            Com tudo desmarcado, sai só o “Antes de ler”.
          </p>
        )}
      </ParteDoDialogo>

      <ParteDoDialogo titulo="Como sai">
        <Opcao
          marcada={graficos}
          onMudar={setGraficos}
          titulo="Com gráficos"
          texto="Desfechos por réu em barras e, no detalhe dos pedidos, as ações por ano em colunas. Sem gráficos, sai tudo em tabela."
        />
        <p className="text-xs leading-snug text-muted-foreground">
          Nenhum nome de filiado ou de advogado e nenhum número de processo entram no papel. Réu pessoa
          física sai como “Pessoa física”.
        </p>
      </ParteDoDialogo>

      <TituloEObservacao
        titulo={titulo}
        onTitulo={setTitulo}
        observacao={observacao}
        onObservacao={setObservacao}
        tituloPadrao={tituloPadraoDoPanorama()}
      />
    </DialogoDoPdf>
  );
}
