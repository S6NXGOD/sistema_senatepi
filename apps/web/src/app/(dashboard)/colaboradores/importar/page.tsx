'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, FileJson, Loader2, RefreshCw, Search,
  Undo2, UploadCloud, UserPlus, Users, XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { mascararCpf } from '@/lib/utils';
import { formatarDuracao, formatarTamanho } from '@/lib/importacao';
import {
  ClassificacaoColaborador,
  ESTRATEGIA_DEPENDENTES_LABEL,
  EstrategiaDependentes,
  ImportacaoColaboradores,
  LinhaColaboradorLegado,
  confirmarEquipe,
  enviarArquivoEquipe,
  linhasEquipe,
  resumoEquipe,
} from '@/lib/importacao-colaboradores';
import { STATUS_COLAB_LABEL, StatusColaborador } from '@/lib/colaboradores';
import { PaginaInexistente } from '@/components/gate-de-modulo';
import { importadorAtivo } from '@/tenant.config';

const PASSOS = ['Arquivo', 'Conferência', 'Importação', 'Resumo'];

const PARENTESCO: Record<string, string> = {
  CONJUGE: 'Cônjuge', FILHO: 'Filho(a)', PAI: 'Pai', MAE: 'Mãe',
};

/**
 * IMPORTAÇÃO DA EQUIPE — funcionários, prestadores e dependentes.
 *
 * Quatro passos, como a importação de filiados, porque é o mesmo desenho e o
 * mesmo operador. A diferença que importa está no passo 2: aqui a prévia mostra
 * A FAMÍLIA junto de cada pessoa. Dependente é metade do que se está
 * importando, e conferir depois de gravado não é conferir.
 */
export default function ImportarEquipePage() {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState(1);
  const [id, setId] = useState<string | null>(null);

  // Passo 1 — arquivo
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reenvioBloqueado, setReenvioBloqueado] = useState<string | null>(null);

  // Passo 2 — conferência
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('');
  const [page, setPage] = useState(1);
  const [atualizarExistentes, setAtualizarExistentes] = useState(true);
  const [estrategia, setEstrategia] = useState<EstrategiaDependentes>('ACRESCENTAR');
  const [somenteValidos, setSomenteValidos] = useState(true);
  const [confirmando, setConfirmando] = useState(false);

  /**
   * A tela existe só onde a migração foi declarada — o par do 404 que a API dá
   * em `importadorAtivo`. Quem digita a URL vê "esta página não existe aqui", a
   * mesma resposta de módulo desligado; redirecionar em silêncio deixaria a
   * pessoa sem saber se errou o endereço ou se a funcionalidade sumiu.
   */
  const disponivel = importadorAtivo('colaboradores-legado');

  const { data: resumo } = useQuery({
    queryKey: ['import-equipe-resumo', id],
    queryFn: () => resumoEquipe(id!),
    enabled: !!id,
    // Enquanto grava, a barra precisa andar. Parado, não faz sentido consultar.
    refetchInterval: (q) =>
      q.state.data?.importacao.status === 'IMPORTANDO' ? 800 : false,
  });
  const imp = resumo?.importacao;

  const { data: linhas } = useQuery({
    queryKey: ['import-equipe-linhas', id, busca, filtro, page],
    queryFn: () => linhasEquipe(id!, { busca, classificacao: filtro || undefined, page }),
    enabled: !!id && etapa === 2,
  });

  useEffect(() => {
    if (!imp) return;
    if (etapa === 3 && imp.status === 'CONCLUIDO') setEtapa(4);
    if (imp.status === 'ERRO') toast.error(imp.erroMensagem ?? 'Falha na importação.');
  }, [imp, etapa]);

  async function enviar(permitirReenvio = false) {
    if (!file) return;
    setEnviando(true);
    try {
      const data = await enviarArquivoEquipe(file, permitirReenvio);
      setId(data.id);
      // Arquivo com erro começa com "importar só as válidas" marcado — é o que
      // o operador quer em 9 de 10 casos, e ele pode desmarcar.
      setSomenteValidos(data.comErro > 0);
      setReenvioBloqueado(null);
      setEtapa(2);
      toast.success(
        `${data.total} pessoa(s) lida(s)` +
          (data.dependentesNoArquivo ? ` e ${data.dependentesNoArquivo} dependente(s)` : ''),
      );
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Erro ao processar o arquivo';
      // Arquivo repetido não é erro do operador: é um aviso com saída.
      if (typeof msg === 'string' && msg.includes('já foi importado')) setReenvioBloqueado(msg);
      else toast.error(msg);
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar() {
    if (!id) return;
    setConfirmando(true);
    try {
      await confirmarEquipe(id, {
        atualizarExistentes,
        dependentes: estrategia,
        importarSomenteValidos: somenteValidos,
      });
      setEtapa(3);
      qc.invalidateQueries({ queryKey: ['import-equipe-resumo', id] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível iniciar a importação');
    } finally {
      setConfirmando(false);
    }
  }

  if (!disponivel)
    return (
      <PaginaInexistente motivo="Não há migração de sistema antigo configurada nesta instalação." />
    );

  const pct = imp && imp.total > 0 ? Math.round((imp.processados / imp.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/colaboradores" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-2xl font-bold">Importar equipe do sistema antigo</h2>
          <p className="text-sm text-muted-foreground">
            Funcionários, prestadores e os dependentes de cada um — em JSON ou planilha
          </p>
        </div>
      </div>

      <Passos atual={etapa} />

      {/* ------------------------------------------------ 1. Arquivo ------ */}
      {etapa === 1 && (
        <Card>
          <CardHeader><CardTitle>Escolha o arquivo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-10 text-center hover:border-brand-500 hover:bg-brand-50/40"
            >
              <UploadCloud className="h-10 w-10 text-muted-foreground" />
              <span className="font-medium">
                {file ? file.name : 'Clique para escolher o arquivo'}
              </span>
              <span className="text-sm text-muted-foreground">
                {file ? formatarTamanho(file.size) : '.json (do sistema antigo), .csv ou .xlsx'}
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReenvioBloqueado(null);
              }}
            />

            {reenvioBloqueado && (
              <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="space-y-2">
                  <p>{reenvioBloqueado}</p>
                  <Button size="sm" variant="outline" onClick={() => enviar(true)} disabled={enviando}>
                    <RefreshCw className="h-4 w-4" /> Importar mesmo assim
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
              <p className="mb-1 flex items-center gap-2 font-medium text-foreground">
                <FileJson className="h-4 w-4" /> O que o arquivo precisa ter
              </p>
              <p>
                <strong>CPF válido</strong> em todas as pessoas — é ele que identifica quem
                já está cadastrado e o que impede a segunda carga de duplicar a equipe.
              </p>
              <p className="mt-1">
                <strong>tipo_contrato</strong> com <code>funcionario</code>,{' '}
                <code>prestador</code>, <code>estagio</code> ou <code>terceirizado</code>.
              </p>
              <p className="mt-1">
                Cargo, setor, contato, endereço e a lista de <strong>dependentes</strong>{' '}
                (nome, parentesco e data de nascimento) entram quando existem.
                Nada é gravado antes de você conferir a prévia.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => enviar(false)} disabled={!file || enviando}>
                {enviando
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Lendo…</>
                  : <>Ler o arquivo</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* -------------------------------------------- 2. Conferência ------ */}
      {etapa === 2 && resumo && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile icone={<UserPlus className="h-5 w-5" />} rotulo="Novos" valor={resumo.contagem.NOVO} />
            <Tile icone={<RefreshCw className="h-5 w-5" />} rotulo="Já cadastrados" valor={resumo.contagem.ATUALIZACAO} />
            <Tile icone={<Users className="h-5 w-5" />} rotulo="Dependentes" valor={resumo.dependentes} />
            <Tile icone={<AlertTriangle className="h-5 w-5" />} rotulo="Com aviso" valor={resumo.contagem.COM_AVISO} tom="amber" />
            <Tile icone={<XCircle className="h-5 w-5" />} rotulo="Com erro" valor={resumo.contagem.ERRO} tom="red" />
          </div>

          {resumo.problemas.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">O que conferir</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {/* Agrupado por PROBLEMA: "38 sem CPF" diz qual coluna consertar
                    na origem; "38 com erro" não diz nada. */}
                {resumo.problemas.map((p) => (
                  <Badge key={p.codigo} className="bg-muted text-foreground">
                    {p.rotulo} — <strong className="ml-1">{p.total}</strong>
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Como gravar</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Opcao
                marcado={atualizarExistentes}
                onChange={setAtualizarExistentes}
                titulo="Atualizar quem já está cadastrado"
                detalhe="Casa pelo CPF. Desmarcado, quem já existe é apenas contado como ignorado."
              />
              <div>
                <p className="mb-1 font-medium">Dependentes de quem já está cadastrado</p>
                <select
                  className="h-10 w-full max-w-xl rounded-md border border-input bg-background px-3 text-sm"
                  value={estrategia}
                  onChange={(e) => setEstrategia(e.target.value as EstrategiaDependentes)}
                  disabled={!atualizarExistentes}
                >
                  {(Object.keys(ESTRATEGIA_DEPENDENTES_LABEL) as EstrategiaDependentes[]).map((k) => (
                    <option key={k} value={k}>{ESTRATEGIA_DEPENDENTES_LABEL[k]}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {estrategia === 'SUBSTITUIR'
                    ? 'Atenção: remove os dependentes que a secretaria tenha cadastrado à mão e que não estejam no arquivo.'
                    : 'Quem chega novo recebe a família do arquivo de qualquer forma — esta escolha só vale para quem já existe.'}
                </p>
              </div>
              {resumo.contagem.ERRO > 0 && (
                <Opcao
                  marcado={somenteValidos}
                  onChange={setSomenteValidos}
                  titulo={`Importar as ${resumo.contagem.NOVO + resumo.contagem.ATUALIZACAO} linhas válidas mesmo assim`}
                  detalhe={`${resumo.contagem.ERRO} linha(s) com erro ficam de fora. Desmarcado, nada é importado até o arquivo estar limpo.`}
                />
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, CPF ou matrícula…"
                className="pl-10"
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setPage(1); }}
              />
            </div>
            <select
              className="h-12 rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
              value={filtro}
              onChange={(e) => { setFiltro(e.target.value); setPage(1); }}
            >
              <option value="">Todas as linhas</option>
              <option value="NOVO">Só as novas</option>
              <option value="ATUALIZACAO">Só as já cadastradas</option>
              <option value="AVISO">Só as com aviso</option>
              <option value="ERRO">Só as com erro</option>
            </select>
          </div>

          <Card>
            <CardContent className="divide-y p-0">
              {linhas?.data.map((l) => <LinhaPrevia key={l.id} linha={l} />)}
              {linhas?.data.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma linha com este filtro.
                </p>
              )}
            </CardContent>
          </Card>

          {linhas && linhas.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <span className="text-sm text-muted-foreground">Página {page} de {linhas.totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= linhas.totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => { setEtapa(1); setId(null); }}>
              <Undo2 className="h-4 w-4" /> Trocar de arquivo
            </Button>
            <Button
              onClick={confirmar}
              disabled={confirmando || resumo.contagem.NOVO + resumo.contagem.ATUALIZACAO === 0}
            >
              {confirmando
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Iniciando…</>
                : <>Gravar {resumo.contagem.NOVO + resumo.contagem.ATUALIZACAO} pessoa(s)</>}
            </Button>
          </div>
        </div>
      )}

      {/* --------------------------------------------- 3. Importação ------ */}
      {etapa === 3 && imp && (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-600" />
            <p className="font-medium">Gravando a equipe…</p>
            <div className="mx-auto h-2 w-full max-w-md overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {imp.processados} de {imp.total} ({pct}%)
            </p>
          </CardContent>
        </Card>
      )}

      {/* -------------------------------------------------- 4. Resumo ----- */}
      {etapa === 4 && imp && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-brand-600" /> Importação concluída
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Tile icone={<UserPlus className="h-5 w-5" />} rotulo="Cadastrados" valor={imp.importados} />
              <Tile icone={<RefreshCw className="h-5 w-5" />} rotulo="Atualizados" valor={imp.atualizados} />
              <Tile icone={<Users className="h-5 w-5" />} rotulo="Dependentes incluídos" valor={imp.dependentesCriados} />
              <Tile icone={<Undo2 className="h-5 w-5" />} rotulo="Dependentes removidos" valor={imp.dependentesRemovidos} tom={imp.dependentesRemovidos ? 'amber' : undefined} />
              <Tile icone={<XCircle className="h-5 w-5" />} rotulo="Com falha" valor={imp.comErro} tom={imp.comErro ? 'red' : undefined} />
            </div>
            <p className="text-sm text-muted-foreground">
              Arquivo &ldquo;{imp.nomeArquivo}&rdquo; · {formatarDuracao(imp.duracaoMs)} ·{' '}
              {imp.ignorados} ignorado(s). O registro completo ficou na Auditoria e no
              histórico de cada pessoa.
            </p>
            <div className="flex gap-2">
              <Link href="/colaboradores"><Button>Ver a equipe</Button></Link>
              <Button variant="outline" onClick={() => { setEtapa(1); setId(null); setFile(null); }}>
                Importar outro arquivo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LinhaPrevia({ linha }: { linha: LinhaColaboradorLegado }) {
  const cor: Record<ClassificacaoColaborador, string> = {
    NOVO: 'bg-brand-50 text-brand-800',
    ATUALIZACAO: 'bg-blue-100 text-blue-700',
    ERRO: 'bg-red-100 text-red-700',
  };
  const rotulo: Record<ClassificacaoColaborador, string> = {
    NOVO: 'Novo', ATUALIZACAO: 'Já cadastrado', ERRO: 'Erro',
  };
  const c = linha.classificacao ?? 'ERRO';

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">
            <span className="mr-2 text-xs text-muted-foreground">#{linha.linha}</span>
            {linha.nome || '(sem nome)'}
          </p>
          <p className="text-xs text-muted-foreground">
            {linha.cpf ? mascararCpf(linha.cpf) : 'sem CPF'}
            {linha.matricula ? ` · matrícula ${linha.matricula}` : ''}
            {linha.cargo ? ` · ${linha.cargo}` : ''}
            {linha.lotacao ? ` · ${linha.lotacao}` : ''}
            {linha.empresa ? ` · ${linha.empresa}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {linha.situacao && (
            <Badge className="bg-muted text-foreground">
              {STATUS_COLAB_LABEL[linha.situacao as StatusColaborador] ?? linha.situacao}
            </Badge>
          )}
          <Badge className={cor[c]}>{rotulo[c]}</Badge>
        </div>
      </div>

      {/* A FAMÍLIA aparece junto da pessoa — é metade do que se está importando. */}
      {linha.dependentes.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-l-2 pl-3 text-sm">
          {linha.dependentes.map((d, i) => (
            <li key={i} className="text-muted-foreground">
              <Users className="mr-1.5 inline h-3.5 w-3.5" />
              {d.nome}{' '}
              <span className="text-xs">
                ({PARENTESCO[d.tipo] ?? d.tipo} · {formatarData(d.dataNascimento)})
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* O QUE VAI MUDAR em quem já existe — sem isto, "atualizado" é um número
          que ninguém consegue conferir. */}
      {linha.alteracoes && Object.keys(linha.alteracoes).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-blue-700 dark:text-blue-400">
          {Object.entries(linha.alteracoes).map(([campo, { de, para }]) => (
            <li key={campo}>
              {campo}: <s>{String(de ?? '—')}</s> → <strong>{String(para)}</strong>
            </li>
          ))}
        </ul>
      )}

      {linha.erros?.map((e, i) => (
        <p key={i} className="mt-1 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e}
        </p>
      ))}
      {linha.avisos?.map((a, i) => (
        <p key={i} className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}
        </p>
      ))}
    </div>
  );
}

function Passos({ atual }: { atual: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {PASSOS.map((p, i) => (
        <div key={p} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              i + 1 <= atual ? 'bg-brand-600 text-white' : 'bg-muted text-muted-foreground'
            }`}
          >
            {i + 1}
          </span>
          <span className={i + 1 === atual ? 'font-medium' : 'text-muted-foreground'}>{p}</span>
          {i < PASSOS.length - 1 && <span className="mx-1 text-muted-foreground">›</span>}
        </div>
      ))}
    </div>
  );
}

function Tile({
  icone, rotulo, valor, tom,
}: {
  icone: React.ReactNode; rotulo: string; valor: number; tom?: 'amber' | 'red';
}) {
  const cor =
    tom === 'red' ? 'text-red-600 dark:text-red-400'
      : tom === 'amber' ? 'text-amber-600 dark:text-amber-500'
        : 'text-brand-600';
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cor}>{icone}</span>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-none">{valor}</p>
          <p className="truncate text-xs text-muted-foreground">{rotulo}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Opcao({
  marcado, onChange, titulo, detalhe,
}: {
  marcado: boolean; onChange: (v: boolean) => void; titulo: string; detalhe: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={marcado}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{detalhe}</span>
      </span>
    </label>
  );
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : iso;
}
