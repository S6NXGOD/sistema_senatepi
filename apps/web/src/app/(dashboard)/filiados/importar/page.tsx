'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, UploadCloud, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Search, FileText, Download, Users, RefreshCw, ListChecks, Ban, Pencil,
} from 'lucide-react';
import { api } from '@/lib/api';
import { abrirPdf, baixarArquivo } from '@/lib/pdf';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { mascararCpf } from '@/lib/utils';
import {
  Importacao, ImportacaoLinha, ResumoValidacao, EstrategiaDuplicado, EstrategiaMatricula,
  formatarTamanho, formatarDuracao,
} from '@/lib/importacao';
import { EditarLinhaDialog } from '@/components/filiados/editar-linha-dialog';

const PASSOS = ['Upload', 'Revisão', 'Importação', 'Resumo'];

export default function ImportarFiliadosPage() {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState(1);
  const [id, setId] = useState<string | null>(null);

  // upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  // revisão
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'' | 'validos' | 'erros' | 'duplicados'>('');
  const [page, setPage] = useState(1);
  const [estrategia, setEstrategia] = useState<EstrategiaDuplicado>('IGNORAR');
  const [estrategiaMatricula, setEstrategiaMatricula] = useState<EstrategiaMatricula>('REGENERAR');
  const [somenteValidos, setSomenteValidos] = useState(true);
  const [permitirCpfInvalido, setPermitirCpfInvalido] = useState(false);
  const [editando, setEditando] = useState<ImportacaoLinha | null>(null);

  // Importação (acompanha progresso por polling enquanto IMPORTANDO)
  const { data: imp } = useQuery<Importacao>({
    queryKey: ['importacao', id],
    queryFn: async () => (await api.get(`/importacoes/${id}`)).data,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'IMPORTANDO' ? 800 : false),
  });

  const { data: linhas } = useQuery({
    queryKey: ['importacao-linhas', id, busca, filtro, page],
    queryFn: async () =>
      (await api.get(`/importacoes/${id}/linhas`, { params: { busca, status: filtro || undefined, page } })).data,
    enabled: !!id && etapa === 2,
  });

  const { data: resumo } = useQuery<ResumoValidacao>({
    queryKey: ['importacao-resumo', id],
    queryFn: async () => (await api.get(`/importacoes/${id}/resumo-validacao`)).data,
    enabled: !!id && etapa === 2,
  });

  function recarregarRevisao() {
    qc.invalidateQueries({ queryKey: ['importacao', id] });
    qc.invalidateQueries({ queryKey: ['importacao-linhas', id] });
    qc.invalidateQueries({ queryKey: ['importacao-resumo', id] });
  }

  // Uma linha com erro será importada se: o único bloqueio for CPF inválido E a opção estiver marcada
  function seraImportada(l: ImportacaoLinha): boolean {
    if (l.valido) return true;
    if (!permitirCpfInvalido) return false;
    const bloqueiosReais = (l.codigos ?? []).filter((c) => c === 'NOME_AUSENTE' || c === 'CPF_DUP_ARQUIVO');
    return (l.codigos ?? []).includes('CPF_INVALIDO') && bloqueiosReais.length === 0;
  }

  useEffect(() => {
    if (!imp) return;
    if (etapa === 3 && imp.status === 'CONCLUIDO') setEtapa(4);
    if (imp.status === 'ERRO') toast.error('Falha na importação. Veja o relatório.');
  }, [imp, etapa]);

  async function enviar() {
    if (!file) return;
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      const { data } = await api.post<Importacao>('/importacoes/upload', fd);
      setId(data.id);
      qc.setQueryData(['importacao', data.id], data);
      setSomenteValidos(data.comErro > 0);
      setEtapa(2);
      toast.success(`${data.total} registros lidos`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Erro ao processar o arquivo');
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar() {
    if (!id) return;
    try {
      await api.post(`/importacoes/${id}/confirmar`, { estrategia, estrategiaMatricula, importarSomenteValidos: somenteValidos, permitirCpfInvalido });
      setEtapa(3);
      qc.invalidateQueries({ queryKey: ['importacao', id] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível iniciar a importação');
    }
  }

  const pct = imp && imp.total > 0 ? Math.round((imp.processados / imp.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/filiados" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h2 className="text-2xl font-bold">Importação de Filiados</h2>
          <p className="text-sm text-muted-foreground">Migre filiados em lote a partir de um arquivo CSV do sistema legado</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {PASSOS.map((p, i) => {
          const n = i + 1;
          const ativo = etapa === n;
          const feito = etapa > n;
          return (
            <div key={p} className="flex flex-1 items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${feito ? 'bg-senatepi-600 text-white' : ativo ? 'bg-senatepi-800 text-white' : 'bg-muted text-muted-foreground'}`}>
                {feito ? <CheckCircle2 className="h-5 w-5" /> : n}
              </div>
              <span className={`text-sm ${ativo ? 'font-semibold' : 'text-muted-foreground'}`}>{p}</span>
              {n < PASSOS.length && <div className={`h-0.5 flex-1 ${feito ? 'bg-senatepi-600' : 'bg-muted'}`} />}
            </div>
          );
        })}
      </div>

      {/* ETAPA 1 — UPLOAD */}
      {etapa === 1 && (
        <Card>
          <CardHeader><CardTitle>Selecione o arquivo CSV</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border py-14 transition-colors hover:border-senatepi-600 hover:bg-senatepi-50/40"
              onClick={() => fileRef.current?.click()}
            >
              <UploadCloud className="h-10 w-10 text-senatepi-800" />
              <p className="text-sm font-medium">Clique para escolher o arquivo .csv</p>
              <p className="text-xs text-muted-foreground">Suporta arquivos com mais de 10.000 registros</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>

            {file && (
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-8 w-8 text-senatepi-800" />
                  <div>
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatarTamanho(file.size)}</p>
                  </div>
                </div>
                <Button onClick={enviar} disabled={enviando}>
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                  Ler e validar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ETAPA 2 — REVISÃO (mapeamento + validação + prévia) */}
      {etapa === 2 && imp && (
        <div className="space-y-6">
          {/* Indicadores */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Indicador titulo="Total" valor={imp.total} icon={Users} cor="text-senatepi-800" />
            <Indicador titulo="Válidos" valor={imp.validos} icon={CheckCircle2} cor="text-senatepi-600" />
            <Indicador titulo="Com erro" valor={imp.comErro} icon={XCircle} cor="text-red-600" />
            <Indicador titulo="Duplicados (já no sistema)" valor={imp.duplicados} icon={AlertTriangle} cor="text-amber-600" />
          </div>

          {/* Resumo de problemas por tipo */}
          {((resumo?.erros.length ?? 0) > 0 || (resumo?.avisos.length ?? 0) > 0) && (
            <Card>
              <CardHeader><CardTitle>Resumo de problemas</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-600"><XCircle className="h-4 w-4" /> Erros (bloqueiam)</p>
                  {resumo?.erros.length ? (
                    <ul className="space-y-1">
                      {resumo.erros.map((e) => (
                        <li key={e.codigo}>
                          <button className="flex w-full items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-left text-sm hover:bg-red-100" onClick={() => { setFiltro('erros'); setPage(1); }}>
                            <span>{e.label}</span>
                            <Badge className="bg-red-100 text-red-700">{e.total}</Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">Nenhum erro 🎉</p>}
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-600"><AlertTriangle className="h-4 w-4" /> Avisos (não bloqueiam)</p>
                  {resumo?.avisos.length ? (
                    <ul className="space-y-1">
                      {resumo.avisos.map((a) => (
                        <li key={a.codigo}>
                          <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm">
                            <span>{a.label}</span>
                            <Badge className="bg-amber-100 text-amber-700">{a.total}</Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">Nenhum aviso</p>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Mapeamento */}
          <Card>
            <CardHeader><CardTitle>Mapeamento de colunas (automático)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {imp.mapeamento?.map((m) => (
                <div key={m.coluna} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{m.coluna}</span>
                  {m.campo ? (
                    <span className="font-medium text-senatepi-800">→ {m.rotulo}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">ignorada</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Prévia */}
          <Card>
            <CardHeader><CardTitle>Prévia de conferência</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative max-w-xs flex-1">
                  <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input placeholder="Buscar nome, CPF, matrícula..." className="pl-10" value={busca} onChange={(e) => { setBusca(e.target.value); setPage(1); }} />
                </div>
                {([['', 'Todos'], ['validos', 'Válidos'], ['erros', 'Com erro'], ['duplicados', 'Duplicados']] as const).map(([v, label]) => (
                  <Button key={v} size="sm" variant={filtro === v ? 'default' : 'outline'} onClick={() => { setFiltro(v); setPage(1); }}>{label}</Button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">CPF</th>
                      <th className="px-3 py-2 font-medium">Matrícula</th>
                      <th className="px-3 py-2 font-medium">Telefone</th>
                      <th className="px-3 py-2 font-medium">Empresa</th>
                      <th className="px-3 py-2 font-medium">Situação</th>
                      <th className="px-3 py-2 font-medium">Status / Mensagens</th>
                      <th className="px-3 py-2 text-right font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas?.data?.map((l: ImportacaoLinha) => (
                      <tr key={l.id} className="border-b last:border-0 align-top">
                        <td className="px-3 py-2 text-muted-foreground">{l.linha}</td>
                        <td className="px-3 py-2 font-medium">{l.nome ?? '-'}</td>
                        <td className="px-3 py-2">{l.cpf ? mascararCpf(l.cpf) : '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{l.matricula ?? '—'}</td>
                        <td className="px-3 py-2">{l.telefone ?? '-'}</td>
                        <td className="px-3 py-2">{l.empresa ?? '-'}</td>
                        <td className="px-3 py-2">{l.situacao ?? '-'}</td>
                        <td className="px-3 py-2">
                          {l.valido ? (
                            l.duplicadoNoSistema ? (
                              <Badge className="bg-amber-100 text-amber-700">Duplicado</Badge>
                            ) : (
                              <Badge className="bg-senatepi-50 text-senatepi-800">OK</Badge>
                            )
                          ) : seraImportada(l) ? (
                            <Badge className="bg-orange-100 text-orange-700">Importará c/ ressalva</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-700">Erro</Badge>
                          )}
                          {/* Erros em vermelho */}
                          {(l.erros ?? []).map((m, i) => (
                            <p key={`e${i}`} className="mt-1 max-w-[280px] text-[11px] text-red-600">• {m}</p>
                          ))}
                          {/* Avisos em âmbar */}
                          {(l.avisos ?? []).map((m, i) => (
                            <p key={`a${i}`} className="mt-1 max-w-[280px] text-[11px] text-amber-600">• {m}</p>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="icon" title="Corrigir" onClick={() => setEditando(l)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {linhas && linhas.data.length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Nenhum registro</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {linhas && linhas.totalPages > 1 && (
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                  <span className="text-sm text-muted-foreground">Página {page} de {linhas.totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= linhas.totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Opções + confirmar */}
          <Card>
            <CardHeader><CardTitle>Opções de importação</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">Quando o CPF já existir no sistema ({imp.duplicados}):</p>
                <div className="flex gap-3">
                  <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${estrategia === 'IGNORAR' ? 'border-senatepi-600 bg-senatepi-50/40' : ''}`}>
                    <input type="radio" className="accent-senatepi-800" checked={estrategia === 'IGNORAR'} onChange={() => setEstrategia('IGNORAR')} />
                    Ignorar (não altera o existente)
                  </label>
                  <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${estrategia === 'ATUALIZAR' ? 'border-senatepi-600 bg-senatepi-50/40' : ''}`}>
                    <input type="radio" className="accent-senatepi-800" checked={estrategia === 'ATUALIZAR'} onChange={() => setEstrategia('ATUALIZAR')} />
                    Atualizar cadastro existente
                  </label>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Quando a matrícula colidir (já usada por outra pessoa):</p>
                <div className="flex gap-3">
                  <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${estrategiaMatricula === 'REGENERAR' ? 'border-senatepi-600 bg-senatepi-50/40' : ''}`}>
                    <input type="radio" className="accent-senatepi-800" checked={estrategiaMatricula === 'REGENERAR'} onChange={() => setEstrategiaMatricula('REGENERAR')} />
                    Gerar uma nova matrícula
                  </label>
                  <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${estrategiaMatricula === 'DISPENSAR' ? 'border-senatepi-600 bg-senatepi-50/40' : ''}`}>
                    <input type="radio" className="accent-senatepi-800" checked={estrategiaMatricula === 'DISPENSAR'} onChange={() => setEstrategiaMatricula('DISPENSAR')} />
                    Dispensar a pessoa (não importar)
                  </label>
                </div>
              </div>

              {(resumo?.erros.find((e) => e.codigo === 'CPF_INVALIDO')?.total ?? 0) > 0 && (
                <label className="flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">
                  <input type="checkbox" className="accent-orange-600" checked={permitirCpfInvalido} onChange={(e) => setPermitirCpfInvalido(e.target.checked)} />
                  Importar mesmo assim os {resumo?.erros.find((e) => e.codigo === 'CPF_INVALIDO')?.total} CPF(s) inválido(s) (dígito verificador) — ficam registrados como aviso
                </label>
              )}

              {imp.comErro > 0 && (
                <label className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <input type="checkbox" className="accent-amber-600" checked={somenteValidos} onChange={(e) => setSomenteValidos(e.target.checked)} />
                  Importar somente os registros válidos (ignorar as linhas que continuarem com erro)
                </label>
              )}

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => { setEtapa(1); setId(null); setFile(null); }}>Recomeçar</Button>
                <Button onClick={confirmar}>
                  <CheckCircle2 className="h-4 w-4" /> Confirmar importação
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ETAPA 3 — PROGRESSO */}
      {etapa === 3 && imp && (
        <Card>
          <CardContent className="flex flex-col items-center gap-5 py-16">
            <Loader2 className="h-10 w-10 animate-spin text-senatepi-800" />
            <p className="text-lg font-semibold">Importando filiados...</p>
            <div className="w-full max-w-md">
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-senatepi-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                {imp.processados} de {imp.total} ({pct}%)
              </p>
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <span>✅ {imp.importados} criados</span>
              <span>🔄 {imp.atualizados} atualizados</span>
              <span>⏭️ {imp.ignorados} ignorados</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ETAPA 4 — RESUMO */}
      {etapa === 4 && imp && (
        <div className="space-y-6">
          <Card className="border-senatepi-600">
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-senatepi-700" />
              <p className="text-xl font-bold">Importação concluída!</p>
              <p className="text-sm text-muted-foreground">Tempo de execução: {formatarDuracao(imp.duracaoMs)}</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Indicador titulo="Importados" valor={imp.importados} icon={Users} cor="text-senatepi-800" />
            <Indicador titulo="Atualizados" valor={imp.atualizados} icon={RefreshCw} cor="text-senatepi-600" />
            <Indicador titulo="Ignorados" valor={imp.ignorados} icon={AlertTriangle} cor="text-amber-600" />
            <Indicador titulo="Dispensados" valor={imp.dispensados} icon={Ban} cor="text-orange-600" />
            <Indicador titulo="Com erro" valor={imp.comErro} icon={XCircle} cor="text-red-600" />
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={() => abrirPdf(`/importacoes/${id}/relatorio.pdf`)}>
              <FileText className="h-4 w-4" /> Relatório PDF
            </Button>
            <Button variant="outline" onClick={() => baixarArquivo(`/importacoes/${id}/relatorio.xlsx`, `importacao-${id}.xlsx`)}>
              <Download className="h-4 w-4" /> Relatório Excel
            </Button>
            <Link href="/filiados"><Button><Users className="h-4 w-4" /> Ver filiados</Button></Link>
          </div>
        </div>
      )}

      {editando && id && (
        <EditarLinhaDialog
          importacaoId={id}
          linha={editando}
          onClose={() => setEditando(null)}
          onSaved={recarregarRevisao}
        />
      )}
    </div>
  );
}

function Indicador({ titulo, valor, icon: Icon, cor }: { titulo: string; valor: number; icon: any; cor: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs text-muted-foreground">{titulo}</p>
          <p className="mt-1 text-2xl font-bold">{valor}</p>
        </div>
        <Icon className={`h-7 w-7 ${cor}`} />
      </CardContent>
    </Card>
  );
}
