'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Pencil, Loader2, ShieldCheck, UserPlus, RefreshCw, Camera,
  CalendarClock, Clock, Ban, Upload, FileText, Trash2, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatarData, mascararCpf } from '@/lib/utils';
import {
  getColaborador,
  getHistoricoColaborador,
  anexarDocumentoColaborador,
  removerDocumentoColaborador,
  ColaboradorHistorico,
  STATUS_COLAB_COR,
  STATUS_COLAB_LABEL,
  TIPO_VINCULO_LABEL,
} from '@/lib/colaboradores';
import { StatusModal } from '@/components/colaboradores/status-modal';

const HIST_ICON: Record<string, any> = {
  CADASTRO: UserPlus,
  ALTERACAO: RefreshCw,
  MUDANCA_STATUS: ShieldCheck,
  UPLOAD_FOTO: Camera,
};

export default function ColaboradorDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [statusAberto, setStatusAberto] = useState(false);
  const [enviandoDoc, setEnviandoDoc] = useState(false);

  const { data: c, isLoading } = useQuery({ queryKey: ['colaborador', id], queryFn: () => getColaborador(id) });
  const { data: historico } = useQuery({ queryKey: ['colaborador-historico', id], queryFn: () => getHistoricoColaborador(id) });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['colaborador', id] });
    qc.invalidateQueries({ queryKey: ['colaborador-historico', id] });
    qc.invalidateQueries({ queryKey: ['colaboradores'] });
  };

  async function onDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setEnviandoDoc(true);
    try {
      await anexarDocumentoColaborador(id, f, f.name);
      toast.success('Documento anexado.');
      invalidar();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível anexar.');
    } finally {
      setEnviandoDoc(false);
    }
  }

  async function removerDoc(docId: string) {
    try {
      await removerDocumentoColaborador(id, docId);
      toast.success('Documento removido.');
      invalidar();
    } catch {
      toast.error('Não foi possível remover.');
    }
  }

  if (isLoading || !c) {
    return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/colaboradores" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="flex items-center gap-4">
            {c.fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.fotoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-senatepi-50 text-xl font-bold text-senatepi-800">{c.nome.charAt(0)}</div>
            )}
            <div>
              <h2 className="text-2xl font-bold">{c.nome}</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{c.cargo.nome}</span>·<span>{c.departamento.nome}</span>
                <Badge className={STATUS_COLAB_COR[c.status]}>{STATUS_COLAB_LABEL[c.status]}</Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setStatusAberto(true)}><ShieldCheck className="h-4 w-4" /> Alterar status</Button>
          <Link href={`/colaboradores/${c.id}/editar`}><Button><Pencil className="h-4 w-4" /> Editar</Button></Link>
        </div>
      </div>

      {/* Aviso de situação (dinâmico conforme o status) */}
      {c.status === 'FERIAS' && c.feriasRetornoEm && (
        <AvisoSituacao Icon={CalendarClock} cor="blue" texto={<>Em férias{c.feriasInicio ? <> de <strong>{formatarData(c.feriasInicio)}</strong></> : null} até <strong>{formatarData(c.feriasRetornoEm)}</strong> — retorno automático para Ativo.</>} />
      )}
      {c.status === 'DESLIGADO' && (
        <AvisoSituacao Icon={Ban} cor="red" texto={<>Desligado em <strong>{formatarData(c.dataDesligamento)}</strong>{c.statusMotivo ? <> · {c.statusMotivo}</> : null}.</>} />
      )}
      {(c.status === 'INATIVO' || c.status === 'AFASTADO') && c.statusMotivo && (
        <AvisoSituacao Icon={Clock} cor="amber" texto={<>{STATUS_COLAB_LABEL[c.status]}: <strong>{c.statusMotivo}</strong>.</>} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Dados pessoais</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="CPF" valor={mascararCpf(c.cpf)} />
              <Info label="Nascimento" valor={formatarData(c.dataNascimento)} />
              <Info label="Telefone" valor={c.telefone} />
              <Info label="E-mail" valor={c.email} />
              <Info label="Admissão" valor={formatarData(c.dataAdmissao)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Vínculo e lotação</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="Tipo de vínculo" valor={TIPO_VINCULO_LABEL[c.tipoVinculo]} />
              <Info label="Cargo" valor={c.cargo.nome} />
              <Info label="Departamento" valor={c.departamento.nome} />
              {c.empresa && <Info label="Empresa" valor={c.empresa.razaoSocial} />}
              {c.vencimentoContrato && <Info label="Vencimento do contrato" valor={formatarData(c.vencimentoContrato)} />}
              {c.instituicaoEnsino && <Info label="Instituição de ensino" valor={c.instituicaoEnsino} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Endereço</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="CEP" valor={c.cep} />
              <Info label="Logradouro" valor={c.logradouro} />
              <Info label="Número" valor={c.numero} />
              <Info label="Bairro" valor={c.bairro} />
              <Info label="Cidade" valor={c.cidade} />
              <Info label="UF" valor={c.uf} />
            </CardContent>
          </Card>

          {/* Documentos */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Documentos</CardTitle>
              <div>
                <input type="file" id="doc-colab" className="hidden" onChange={onDoc} />
                <Button variant="outline" size="sm" disabled={enviandoDoc} onClick={() => document.getElementById('doc-colab')?.click()}>
                  {enviandoDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Anexar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!c.documentos || c.documentos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>
              ) : (
                <ul className="divide-y">
                  {c.documentos.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 py-2">
                      <FileText className="h-4 w-4 shrink-0 text-senatepi-800 dark:text-senatepi-400" />
                      <a href={d.url ?? '#'} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm hover:underline">
                        {d.titulo}
                      </a>
                      {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="icon"><ExternalLink className="h-4 w-4" /></Button></a>}
                      <Button variant="ghost" size="icon" className="text-red-600 dark:text-red-400" onClick={() => removerDoc(d.id)}><Trash2 className="h-4 w-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Histórico / auditoria */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Histórico</CardTitle></CardHeader>
          <CardContent>
            {!historico ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : historico.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem registros.</p>
            ) : (
              <ul className="space-y-4">
                {historico.map((h: ColaboradorHistorico) => {
                  const Icon = HIST_ICON[h.tipo] ?? RefreshCw;
                  return (
                    <li key={h.id} className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Icon className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{h.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(h.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                          {h.autor ? ` · ${h.autor}` : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {statusAberto && (
        <StatusModal
          colaborador={{ id: c.id, nome: c.nome, status: c.status }}
          onClose={() => setStatusAberto(false)}
          onConcluido={invalidar}
        />
      )}
    </div>
  );
}

function Info({ label, valor }: { label: string; valor?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{valor || '-'}</p>
    </div>
  );
}

function AvisoSituacao({ Icon, cor, texto }: { Icon: any; cor: 'blue' | 'red' | 'amber'; texto: React.ReactNode }) {
  const cores = {
    blue: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300',
    red: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300',
    amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200',
  }[cor];
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${cores}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{texto}</span>
    </div>
  );
}
