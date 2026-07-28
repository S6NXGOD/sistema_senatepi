'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, Loader2, Search, Save, Receipt, Calculator, X, User,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import {
  simularCobranca, gravarCobranca, TipoCobranca, TIPOS, TIPO_LABEL,
  ParcelaSimulada, formatBRL,
} from '@/lib/cobrancas';

type ParcelaEditavel = { numero: number; dataCompetencia: string; dataVencimento: string; valor: string };

function WizardCobranca() {
  const router = useRouter();
  const params = useSearchParams();
  const filiadoIdPre = params.get('filiadoId') ?? '';

  const [etapa, setEtapa] = useState<1 | 2>(1);

  // Etapa 1 — parâmetros
  const [filiadoId, setFiliadoId] = useState(filiadoIdPre);
  const [filiadoNome, setFiliadoNome] = useState('');
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [tipo, setTipo] = useState<TipoCobranca>('MENSALIDADE');
  const [valorTotal, setValorTotal] = useState('');
  const [qtdParcelas, setQtdParcelas] = useState('1');
  const [competencia, setCompetencia] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [descricao, setDescricao] = useState('');

  // Etapa 2 — parcelas editáveis
  const [parcelas, setParcelas] = useState<ParcelaEditavel[]>([]);
  const [simulando, setSimulando] = useState(false);

  // Pré-carrega o nome do filiado quando veio por query (?filiadoId=)
  useEffect(() => {
    if (!filiadoIdPre) return;
    api.get(`/filiados/${filiadoIdPre}`).then(
      (r) => { setFiliadoId(r.data.id); setFiliadoNome(r.data.nomeCompleto); },
      () => undefined,
    );
  }, [filiadoIdPre]);

  // Autocomplete de filiado (debounce)
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) { setResultados([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      try { setResultados(await buscarFiliados(termo)); } catch { setResultados([]); } finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  function selecionarFiliado(f: FiliadoBusca) {
    setFiliadoId(f.id);
    setFiliadoNome(f.nome);
    setBusca('');
    setResultados([]);
  }

  async function gerarSimulacao() {
    if (!filiadoId) return toast.error('Selecione o filiado.');
    const total = Number(valorTotal);
    const qtd = Number(qtdParcelas);
    if (!(total > 0)) return toast.error('Informe um valor total válido.');
    if (!(qtd >= 1)) return toast.error('Informe a quantidade de parcelas.');
    if (!competencia || !vencimento) return toast.error('Informe as datas base de competência e vencimento.');

    setSimulando(true);
    try {
      const sim = await simularCobranca({
        valorTotal: total,
        quantidadeParcelas: qtd,
        dataCompetenciaInicial: competencia,
        dataVencimentoInicial: vencimento,
        tipo,
      });
      setParcelas(
        sim.parcelas.map((p: ParcelaSimulada) => ({
          numero: p.numero,
          dataCompetencia: p.dataCompetencia,
          dataVencimento: p.dataVencimento,
          valor: p.valor.toFixed(2),
        })),
      );
      setEtapa(2);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível gerar a simulação.');
    } finally {
      setSimulando(false);
    }
  }

  function editarParcela(i: number, campo: keyof ParcelaEditavel, valor: string) {
    setParcelas((arr) => arr.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)));
  }

  const totalEditado = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);

  const gravar = useMutation({
    mutationFn: () =>
      gravarCobranca({
        filiadoId,
        tipo,
        descricao: descricao.trim() || undefined,
        parcelas: parcelas.map((p) => ({
          numero: p.numero,
          dataCompetencia: p.dataCompetencia,
          dataVencimento: p.dataVencimento,
          valor: Number(p.valor),
        })),
      }),
    onSuccess: () => {
      toast.success('Cobrança gravada com sucesso.');
      router.push(filiadoIdPre ? `/filiados/${filiadoId}` : '/cobrancas');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível gravar a cobrança.'),
  });

  function validarGravacao(): boolean {
    if (parcelas.some((p) => !(Number(p.valor) > 0))) { toast.error('Todas as parcelas precisam de um valor válido.'); return false; }
    if (parcelas.some((p) => !p.dataCompetencia || !p.dataVencimento)) { toast.error('Preencha as datas de todas as parcelas.'); return false; }
    return true;
  }

  const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm';

  return (
    <div className="space-y-6">
      {/* Cabeçalho + passos */}
      <div className="flex items-center gap-3">
        <Link href="/cobrancas"><Button variant="ghost" size="icon" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-2xl font-bold"><Receipt className="h-6 w-6 text-senatepi-800 dark:text-senatepi-400" /> Nova cobrança</h2>
          <p className="text-sm text-muted-foreground">Etapa {etapa} de 2 — {etapa === 1 ? 'parâmetros' : 'edição e gravação'}</p>
        </div>
      </div>

      {/* ETAPA 1 */}
      {etapa === 1 && (
        <Card>
          <CardContent className="space-y-4 p-5">
            {/* Filiado */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Filiado *</label>
              {filiadoId ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4 shrink-0 text-senatepi-700 dark:text-senatepi-400" />
                    <span className="truncate">{filiadoNome || 'Filiado selecionado'}</span>
                  </span>
                  {!filiadoIdPre && (
                    <button type="button" onClick={() => { setFiliadoId(''); setFiliadoNome(''); }} className="text-muted-foreground hover:text-foreground" aria-label="Trocar filiado">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Buscar por nome ou CPF…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                    {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
                  </div>
                  {resultados.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-card shadow-lg">
                      {resultados.map((f) => (
                        <li key={f.id}>
                          <button type="button" onClick={() => selecionarFiliado(f)} className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted">
                            <span className="font-medium">{f.nome}</span>
                            <span className="text-xs text-muted-foreground">{f.cpfMascarado}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo de recebimento</label>
                <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoCobranca)}>
                  {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Valor total (R$) *</label>
                <Input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0,00" value={valorTotal} onChange={(e) => setValorTotal(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Quantidade de parcelas *</label>
                <Input type="number" inputMode="numeric" min="1" value={qtdParcelas} onChange={(e) => setQtdParcelas(e.target.value)} />
              </div>
              <div className="hidden sm:block" />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Competência base *</label>
                <Input type="date" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Vencimento base *</label>
                <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Descrição (opcional)</label>
              <Input placeholder="Ex.: Mensalidades 2º semestre" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>

            <Button className="w-full sm:w-auto" onClick={gerarSimulacao} disabled={simulando}>
              {simulando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              Gerar simulação <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ETAPA 2 */}
      {etapa === 2 && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="text-sm">
                <span className="text-muted-foreground">Filiado:</span> <strong>{filiadoNome || 'selecionado'}</strong> ·{' '}
                <span className="text-muted-foreground">{TIPO_LABEL[tipo]}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Total ({parcelas.length}x):</span>{' '}
                <strong className="tabular-nums">{formatBRL(totalEditado)}</strong>
              </div>
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground">
            Revise as parcelas — você pode ajustar o <strong>valor</strong> e as <strong>datas</strong> de cada uma antes de gravar.
          </p>

          <div className="space-y-3">
            {parcelas.map((p, i) => (
              <div key={i} className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-senatepi-50 text-xs font-bold text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400">{p.numero}</span>
                  <span className="text-sm font-medium">Parcela {p.numero}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Competência</label>
                    <Input type="date" value={p.dataCompetencia} onChange={(e) => editarParcela(i, 'dataCompetencia', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Vencimento</label>
                    <Input type="date" value={p.dataVencimento} onChange={(e) => editarParcela(i, 'dataVencimento', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Valor (R$)</label>
                    <Input type="number" inputMode="decimal" step="0.01" min="0" value={p.valor} onChange={(e) => editarParcela(i, 'valor', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setEtapa(1)} disabled={gravar.isPending}>
              <ArrowLeft className="h-4 w-4" /> Voltar aos parâmetros
            </Button>
            <Button onClick={() => { if (validarGravacao()) gravar.mutate(); }} disabled={gravar.isPending}>
              {gravar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Gravar cobrança
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function NovaCobrancaPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>}>
      <WizardCobranca />
    </Suspense>
  );
}
