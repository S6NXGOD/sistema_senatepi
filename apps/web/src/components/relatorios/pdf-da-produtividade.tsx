'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { GRUPO_DO_PERFIL, carregarProdutividade, carregarRostos } from '@/lib/produtividade';
import {
  OPCOES_DA_PRODUTIVIDADE, gerarPdfDaProdutividade, guardarOpcoesDaProdutividade, lerOpcoesDaProdutividade,
  type DetalheDasPessoas, type QuemNoPdf,
} from '@/lib/produtividade-pdf';
import {
  hojeComoTexto, periodoAnterior, periodoDoPreset, periodoValido, type Periodo, type PresetDoPeriodo,
} from '@/lib/periodo-do-pdf';
import {
  DialogoDoPdf, EscolhaDoPeriodo, Opcao, ParteDoDialogo, TituloEObservacao, campoCls,
} from './partes-do-pdf';

const DETALHES: { id: DetalheDasPessoas; titulo: string; texto: string }[] = [
  {
    id: 'TABELA',
    titulo: 'Uma linha por pessoa',
    texto: 'Último acesso, dias com uso e o que cada um registrou, numa tabela.',
  },
  {
    id: 'PAGINAS',
    titulo: 'Uma página por pessoa',
    texto: 'A faixa dos dias, os quadros do perfil e o mês a mês de cada um.',
  },
  {
    id: 'NENHUM',
    titulo: 'Só os totais',
    texto: 'O resumo do grupo, sem o número de ninguém.',
  },
];

/**
 * O PDF DO USO DO SISTEMA — mensal, anual ou das datas escolhidas; da equipe,
 * de um perfil ou de uma pessoa.
 *
 * Os números vêm da mesma rota da aba, e quem só vê a própria linha só gera o
 * próprio PDF: o recorte por perfil e pessoa é feito sobre o que a API já
 * decidiu mostrar.
 */
export function PdfDaProdutividade({
  de, ate, emitidoPor, onFechar,
}: {
  de: string;
  ate: string;
  emitidoPor: string;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['produtividade', de, ate],
    queryFn: () => carregarProdutividade(de, ate),
    placeholderData: keepPreviousData,
  });
  const [salvo] = useState(() => lerOpcoesDaProdutividade());
  const [preset, setPreset] = useState<PresetDoPeriodo>(salvo.preset);
  const [datas, setDatas] = useState<Periodo>({ de, ate });
  const [comparar, setComparar] = useState(salvo.comparar);
  const [graficos, setGraficos] = useState(salvo.graficos);
  const [detalhe, setDetalhe] = useState<DetalheDasPessoas>(salvo.detalhe);
  const [fotos, setFotos] = useState(salvo.fotos);
  const [quem, setQuem] = useState<QuemNoPdf>('TODOS');
  const [titulo, setTitulo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [gerando, setGerando] = useState(false);

  const pessoal = data?.escopo === 'PESSOAL';
  const umaPessoa = pessoal || quem.startsWith('PESSOA:');
  /** A foto só existe onde há cartão de pessoa: nunca na tabela nem nos totais. */
  const temCartaoDePessoa = umaPessoa || detalhe === 'PAGINAS';
  const perfis = useMemo(() => [...new Set((data?.pessoas ?? []).map((l) => l.perfil))], [data]);
  const podeGerar = !!data && !gerando && (preset !== 'PERSONALIZADO' || periodoValido(datas));

  function voltarAoPadrao() {
    setPreset(OPCOES_DA_PRODUTIVIDADE.preset);
    setComparar(OPCOES_DA_PRODUTIVIDADE.comparar);
    setGraficos(OPCOES_DA_PRODUTIVIDADE.graficos);
    setDetalhe(OPCOES_DA_PRODUTIVIDADE.detalhe);
    setFotos(OPCOES_DA_PRODUTIVIDADE.fotos);
    setQuem('TODOS');
  }

  async function gerar() {
    const periodo = periodoDoPreset(preset, hojeComoTexto(new Date()), { de, ate }, datas);
    const buscar = (p: Periodo) =>
      qc.fetchQuery({
        queryKey: ['produtividade', p.de, p.ate],
        queryFn: () => carregarProdutividade(p.de, p.ate),
        staleTime: 60_000,
      });
    const comFotos = fotos && temCartaoDePessoa;
    setGerando(true);
    try {
      guardarOpcoesDaProdutividade({ preset, comparar, graficos, detalhe, fotos });
      // As fotos correm junto com os números; falha ou demora vira {} e o PDF sai com iniciais.
      const [atual, rostos] = await Promise.all([
        buscar(periodo),
        comFotos ? carregarRostos() : Promise.resolve({}),
      ]);
      const antes = comparar ? periodoAnterior(periodo, preset) : null;
      const anterior = antes ? { dados: await buscar(antes), periodo: antes } : null;
      await gerarPdfDaProdutividade(
        atual,
        { quem, detalhe: umaPessoa ? 'PAGINAS' : detalhe, graficos, fotos: comFotos },
        { ...periodo, emitidoPor, titulo, observacao },
        anterior,
        rostos,
      );
      onFechar();
    } catch {
      toast.error('Não foi possível gerar o PDF agora.');
    } finally {
      setGerando(false);
    }
  }

  return (
    <DialogoDoPdf
      titulo="PDF do uso do sistema"
      subtitulo="Os mesmos números da aba, no período e no recorte que você escolher."
      gerando={gerando}
      onFechar={onFechar}
      rodape={
        <>
          <button
            type="button"
            onClick={voltarAoPadrao}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Voltar ao padrão
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar} disabled={gerando}>
              Cancelar
            </Button>
            <Button onClick={gerar} disabled={!podeGerar}>
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Gerar PDF
            </Button>
          </div>
        </>
      }
    >
      <EscolhaDoPeriodo
        preset={preset}
        onPreset={setPreset}
        datas={datas}
        onDatas={setDatas}
        tela={{ de, ate }}
        comparar={comparar}
        onComparar={setComparar}
      />

      {!pessoal && (
        <ParteDoDialogo titulo="Quem entra">
          <select
            value={quem}
            onChange={(e) => setQuem(e.target.value as QuemNoPdf)}
            disabled={!data}
            className={campoCls}
          >
            <option value="TODOS">Toda a equipe</option>
            {perfis.length > 1 && (
              <optgroup label="Um perfil">
                {perfis.map((perfil) => (
                  <option key={perfil} value={`PERFIL:${perfil}`}>
                    {GRUPO_DO_PERFIL[perfil] ?? perfil}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Uma pessoa">
              {(data?.pessoas ?? []).map((l) => (
                <option key={l.usuarioId} value={`PESSOA:${l.usuarioId}`}>
                  {l.nome}
                </option>
              ))}
            </optgroup>
          </select>

          {!umaPessoa && (
            <div className="space-y-2.5" role="radiogroup" aria-label="Detalhe de cada pessoa">
              {DETALHES.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="detalhe-do-pdf"
                    checked={detalhe === d.id}
                    onChange={() => setDetalhe(d.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{d.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{d.texto}</span>
                  </span>
                </label>
              ))}
              {detalhe !== 'NENHUM' && (
                <p className="text-xs leading-snug text-amber-700 dark:text-amber-400">
                  Mostra os números de cada pessoa. É para a coordenação conversar com a equipe — não
                  para afixar nem projetar.
                </p>
              )}
            </div>
          )}
        </ParteDoDialogo>
      )}

      <ParteDoDialogo titulo="Como sai">
        <Opcao
          marcada={graficos}
          onMudar={setGraficos}
          titulo="Com gráficos"
          texto="O mês a mês em colunas, quando o período passa de um mês. Sem gráficos, sai em tabela."
        />
        {temCartaoDePessoa && (
          <Opcao
            marcada={fotos}
            onMudar={setFotos}
            titulo="Com a foto do perfil"
            texto="Só no cartão de cada pessoa, nunca numa tabela. Quem não tem foto sai com as iniciais."
          />
        )}
        <p className="text-xs text-muted-foreground">
          O aviso do que estes números não medem abre o PDF, sempre.
        </p>
      </ParteDoDialogo>

      <TituloEObservacao
        titulo={titulo}
        onTitulo={setTitulo}
        observacao={observacao}
        onObservacao={setObservacao}
        tituloPadrao={pessoal ? 'O meu uso do sistema' : 'Uso e produtividade'}
      />
    </DialogoDoPdf>
  );
}
