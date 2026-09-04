'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { baixarArquivo } from '@/lib/pdf';
import {
  confirmarImportacaoProcessos,
  enviarPlanilhaProcessos,
  linhasImportacaoProcessos,
  minutosEstimados,
  resumoImportacaoProcessos,
  type ConferenciaPlanilha,
  type LinhaConferida,
  type ResumoImportacaoProcessos,
} from '@/lib/importacao-processos';

/**
 * IMPORTAR O ACERVO DE UMA PLANILHA.
 *
 * DUAS FASES, e a separação é o ponto: subir o arquivo só CONFERE. Importar 82
 * processos é irreversível na prática — desfazer significa apagar 82 registros
 * com andamentos do CNJ dentro — e um erro na coluna do advogado só apareceria
 * depois de quarenta minutos de execução.
 *
 * A ESPERA É DITA ANTES. São 2 a 3 segundos de pausa por processo mais a
 * resposta do CNJ (10 a 25s, medidos): oitenta processos são uns 25 minutos.
 * Prometer "só um instante" para isso é o que faz alguém fechar a aba no meio
 * e voltar sem saber o que entrou.
 *
 * MOBILE-FIRST: telas de importação viram tabelas largas por reflexo. Aqui a
 * prévia é uma LISTA — cada linha problemática é um bloco que quebra, não uma
 * célula que trunca. O que a pessoa precisa ler é a mensagem do erro, e
 * mensagem truncada não serve para nada.
 */
export function ImportarLoteDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * O nome do arquivo sai do `Content-Disposition` da API — `baixarArquivo` já
   * cuida disso. O nome aqui é só a rede de proteção se o cabeçalho não vier.
   */
  async function baixarModelo() {
    try {
      await baixarArquivo('/importacoes/processos/modelo', 'modelo-importacao-processos.csv');
    } catch {
      toast.error('Não foi possível baixar o modelo agora.');
    }
  }

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [conferencia, setConferencia] = useState<ConferenciaPlanilha | null>(null);
  const [linhas, setLinhas] = useState<LinhaConferida[]>([]);
  const [resumo, setResumo] = useState<ResumoImportacaoProcessos | null>(null);
  /**
   * DESLIGADO por padrão: ver o comentário de `confirmarImportacaoProcessos`.
   * A planilha costuma trazer acervo antigo, e aí o robô só produz tarefa
   * vencida. Quem estiver importando um lote de casos NOVOS liga aqui.
   */
  const [criarTarefas, setCriarTarefas] = useState(false);

  const rodando = resumo?.status === 'IMPORTANDO';
  const terminou = resumo?.status === 'CONCLUIDO' || resumo?.status === 'ERRO';

  /**
   * Enquanto roda, pergunta como vai de 4 em 4 segundos.
   *
   * O intervalo é curto porque a barra precisa se mexer — uma barra parada por
   * meio minuto passa a impressão de travamento numa operação que leva meia
   * hora, e aí a pessoa recarrega a página no meio.
   */
  useEffect(() => {
    if (!conferencia || !rodando) return;
    const t = setInterval(async () => {
      try {
        const r = await resumoImportacaoProcessos(conferencia.id);
        setResumo(r);
        if (r.status === 'CONCLUIDO' || r.status === 'ERRO') {
          clearInterval(t);
          qc.invalidateQueries({ queryKey: ['processos'] });
          qc.invalidateQueries({ queryKey: ['processos-contadores'] });
        }
      } catch {
        /* uma consulta perdida não derruba o acompanhamento — a próxima tenta */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [conferencia, rodando, qc]);

  function fechar() {
    if (rodando) {
      toast.info('A importação continua rodando no servidor — pode fechar sem medo.');
    }
    setArquivo(null);
    setConferencia(null);
    setLinhas([]);
    setResumo(null);
    // Volta ao padrão seguro: a próxima planilha não herda a escolha desta.
    setCriarTarefas(false);
    onClose();
  }

  async function enviar() {
    if (!arquivo) return;
    setEnviando(true);
    try {
      const c = await enviarPlanilhaProcessos(arquivo);
      setConferencia(c);
      setLinhas(await linhasImportacaoProcessos(c.id, { apenasProblemas: true }));
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : (m ?? 'Não foi possível ler a planilha.'));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar() {
    if (!conferencia) return;
    try {
      await confirmarImportacaoProcessos(conferencia.id, { criarTarefasDePrazo: criarTarefas });
      setResumo(await resumoImportacaoProcessos(conferencia.id));
      toast.success('Importação iniciada — pode acompanhar aqui ou fechar.');
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(m ?? 'Não foi possível iniciar a importação.');
    }
  }

  if (!open) return null;

  /**
   * DOIS TRABALHOS, DOIS NÚMEROS.
   *
   * `aImportar` era `validos - jaCadastrados`, e o botão ficava desabilitado
   * quando dava zero. Parecia razoável até a segunda passada: com os 82
   * processos já cadastrados, a conta dá zero, o botão trava e o único caminho
   * para COMPLETAR o que ficou faltando (área jurídica, etiquetas, andamento
   * do jurídico) fica inalcançável pela tela. Foi exatamente o que aconteceu
   * com o jurídico em 31/08/2026: mandei subir a planilha de novo e o botão
   * não deixava.
   *
   * Agora a conferência devolve os dois números separados, e há trabalho a
   * fazer se QUALQUER um deles for maior que zero.
   */
  const aImportar = conferencia?.novos ?? 0;
  const aCompletar = conferencia?.aCompletar ?? 0;
  const aFazer = aImportar + aCompletar;
  const progresso = resumo && resumo.validos > 0
    ? Math.round((resumo.processados / resumo.validos) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      {/* Tela cheia no celular, cartão no desktop — o padrão das outras fichas. */}
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-t-2xl bg-background shadow-xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-400" />
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight">Importar acervo de uma planilha</h2>
              <p className="text-xs text-muted-foreground">
                Cada processo é buscado no CNJ — classe, vara, instâncias e andamentos vêm de lá.
              </p>
            </div>
          </div>
          <button type="button" onClick={fechar} className="rounded p-1 hover:bg-muted" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* ---------------------------------------------------- 1) arquivo */}
          {!conferencia && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.txt,.xlsx,.xls"
                className="hidden"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition hover:bg-muted/40"
              >
                <UploadCloud className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {arquivo ? arquivo.name : 'Escolher planilha (.csv ou .xlsx)'}
                </span>
                <span className="text-xs text-muted-foreground">
                  Precisa ter, no mínimo, as colunas <strong>npu</strong> e <strong>polo_ativo</strong>
                </span>
              </button>
              {/*
                O MODELO VEM ANTES DA PRIMEIRA TENTATIVA.
                Sem ele, monta-se a planilha adivinhando os nomes das colunas e a
                conferência devolve "Falta a coluna npu" depois de oitenta linhas
                preenchidas. O arquivo é GERADO pela API a partir das mesmas
                constantes que ela usa para conferir — não tem como divergir.
              */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Nada é importado agora — o próximo passo é a conferência, linha a linha.
                </p>
                <button
                  type="button"
                  onClick={baixarModelo}
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand-800 hover:underline dark:text-brand-300"
                >
                  <Download className="h-3.5 w-3.5" /> Baixar planilha modelo
                </button>
              </div>
            </>
          )}

          {/* --------------------------------------------------- 2) prévia */}
          {conferencia && !resumo && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Placar rotulo="Linhas" valor={conferencia.total} />
                <Placar rotulo="Novos" valor={aImportar} tom={aImportar ? 'ok' : undefined} />
                <Placar rotulo="A completar" valor={aCompletar} tom={aCompletar ? 'ok' : undefined} />
                <Placar rotulo="Com erro" valor={conferencia.comErro} tom={conferencia.comErro ? 'erro' : undefined} />
              </div>

              {conferencia.problemasNoArquivo.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50/70 p-2.5 text-xs dark:border-amber-900 dark:bg-amber-950/20">
                  {conferencia.problemasNoArquivo.map((p) => (
                    <li key={p} className="break-words">{p}</li>
                  ))}
                </ul>
              )}

              {linhas.length > 0 && (
                <div>
                  {/*
                    A API devolve no máximo 50 por página e a tela pede só a
                    primeira. Anunciar "50" como se fosse o total mentiria num
                    acervo de 82 — o rótulo diz que a lista está cortada.
                  */}
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Linhas com algo a conferir{' '}
                    {linhas.length >= 50 ? '(primeiras 50)' : `(${linhas.length})`}
                  </p>
                  <ul className="space-y-1.5">
                    {linhas.map((l) => (
                      <li
                        key={l.linha}
                        className={cn(
                          'rounded-lg border p-2 text-xs',
                          l.valido ? 'bg-muted/30' : 'border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20',
                        )}
                      >
                        <p className="flex flex-wrap items-baseline gap-x-2 font-medium">
                          <span className="font-mono">linha {l.linha}</span>
                          <span className="font-mono text-muted-foreground">{l.npu || '(sem NPU)'}</span>
                          {l.reu && <span className="min-w-0 break-words text-muted-foreground">× {l.reu}</span>}
                        </p>
                        {/* Quebra, não trunca: a mensagem É a informação. */}
                        {l.erros.map((m) => (
                          <p key={m} className="mt-0.5 break-words text-red-700 dark:text-red-400">✕ {m}</p>
                        ))}
                        {l.avisos.map((m) => (
                          <p key={m} className="mt-0.5 break-words text-muted-foreground">• {m}</p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/*
                A ESTIMATIVA CONTA SÓ OS NOVOS. A pausa de 2–3s existe para não
                estourar a cota do CNJ, e completar processo que já está no
                sistema não fala com o CNJ — é escrita local. Uma segunda
                passada de 82 linhas leva segundos, não três minutos e meio.
              */}
              {aFazer === 0 ? (
                <p className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-2.5 text-xs dark:border-emerald-800 dark:bg-emerald-950/20">
                  <strong>Nada a fazer com esta planilha.</strong> Os {conferencia.jaCadastrados}{' '}
                  processos já estão cadastrados e já têm tudo o que o arquivo traz — área
                  jurídica, etiquetas e o andamento do jurídico. Subir de novo não mudaria nada.
                </p>
              ) : (
                <p className="rounded-lg border border-sky-300 bg-sky-50/60 p-2.5 text-xs dark:border-sky-800 dark:bg-sky-950/20">
                  {aImportar > 0 && (
                    <>
                      <strong>{aImportar} processo{aImportar === 1 ? '' : 's'} novo{aImportar === 1 ? '' : 's'}</strong>{' '}
                      {aImportar === 1 ? 'será buscado' : 'serão buscados'} no CNJ, um por vez, com pausa
                      entre eles — cerca de <strong>{minutosEstimados(aImportar)} minuto{minutosEstimados(aImportar) === 1 ? '' : 's'}</strong>.{' '}
                    </>
                  )}
                  {aCompletar > 0 && (
                    <>
                      <strong>{aCompletar} já cadastrado{aCompletar === 1 ? '' : 's'}</strong>{' '}
                      {aCompletar === 1 ? 'vai receber' : 'vão receber'} só o que estiver faltando
                      (sem consultar o CNJ, e sem sobrescrever nada que já esteja preenchido) —
                      isso leva segundos.{' '}
                    </>
                  )}
                  {conferencia.jaCompletos > 0 && (
                    <>
                      {conferencia.jaCompletos} linha{conferencia.jaCompletos === 1 ? '' : 's'} já{' '}
                      {conferencia.jaCompletos === 1 ? 'está completa' : 'estão completas'} e{' '}
                      {conferencia.jaCompletos === 1 ? 'será ignorada' : 'serão ignoradas'}.{' '}
                    </>
                  )}
                  Roda no servidor — dá para fechar esta janela e voltar depois.
                </p>
              )}
            </>
          )}

          {/* ------------------------------------------------- 3) andamento */}
          {resumo && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Placar rotulo="Processados" valor={`${resumo.processados}/${resumo.validos}`} />
                <Placar rotulo="Importados" valor={resumo.importados} tom={resumo.importados ? 'ok' : undefined} />
                <Placar rotulo="Completados" valor={resumo.completados} tom={resumo.completados ? 'ok' : undefined} />
                {/*
                  "Sem novidade" e não "Não entraram": a linha já cadastrada e
                  já completa não é uma falha, e pintá-la de vermelho fazia uma
                  segunda passada bem-sucedida parecer um desastre.
                */}
                <Placar rotulo="Sem novidade" valor={resumo.ignorados} />
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full transition-all', terminou ? 'bg-emerald-500' : 'bg-brand-700')}
                  style={{ width: `${progresso}%` }}
                />
              </div>

              {rodando && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importando… pode fechar, continua rodando no servidor.
                </p>
              )}
              {resumo.status === 'CONCLUIDO' && (
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Concluída.
                </p>
              )}
              {resumo.status === 'ERRO' && (
                <p className="flex items-start gap-2 break-words text-sm text-red-700 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {resumo.erroMensagem ?? 'A importação parou por um erro.'}
                </p>
              )}
            </div>
          )}
        </div>

        {conferencia && !resumo && (
          <label className="flex cursor-pointer items-start gap-2.5 border-t bg-muted/40 p-4 sm:px-4 sm:py-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={criarTarefas}
              onChange={(e) => setCriarTarefas(e.target.checked)}
            />
            <span className="min-w-0 text-xs leading-relaxed">
              <span className="font-medium">Abrir tarefas de prazo para as movimentações recentes</span>
              <span className="block text-muted-foreground">
                {criarTarefas
                  ? 'Cada intimação ou publicação dos últimos 30 dias vai gerar uma atividade na agenda. Use só para processos NOVOS.'
                  : 'Recomendado deixar desmarcado ao migrar acervo já acompanhado: os prazos desse período já foram cumpridos, e as tarefas nasceriam vencidas.'}
              </span>
            </span>
          </label>
        )}

        <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={fechar}>
            {terminou || rodando ? 'Fechar' : 'Cancelar'}
          </Button>
          {!conferencia && (
            <Button onClick={enviar} disabled={!arquivo || enviando}>
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Conferir planilha
            </Button>
          )}
          {conferencia && !resumo && (
            <Button onClick={confirmar} disabled={aFazer === 0}>
              {aImportar > 0 && aCompletar > 0
                ? `Importar ${aImportar} e completar ${aCompletar}`
                : aImportar > 0
                  ? `Importar ${aImportar} processo${aImportar === 1 ? '' : 's'}`
                  : aCompletar > 0
                    ? `Completar ${aCompletar} processo${aCompletar === 1 ? '' : 's'}`
                    : 'Nada a fazer'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Placar({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: number | string;
  tom?: 'ok' | 'erro';
}) {
  return (
    <div className="rounded-lg border p-2 text-center">
      <p
        className={cn(
          'text-lg font-bold tabular-nums',
          tom === 'ok' && 'text-emerald-700 dark:text-emerald-400',
          tom === 'erro' && 'text-red-700 dark:text-red-400',
        )}
      >
        {valor}
      </p>
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
    </div>
  );
}
