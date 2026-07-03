'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Pencil, RefreshCw, IdCard, QrCode as QrIcon, FileText, Upload,
  Trash2, Loader2, Clock, UserPlus, ShieldCheck, FileSignature, CreditCard, Baby,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatarData, mascararCpf } from '@/lib/utils';
import { FORMACAO_LABEL, SITUACAO_COR, SITUACAO_LABEL, SITUACOES } from '@/lib/filiados';
import { QrCodeDialog } from '@/components/qrcode-dialog';
import { DependentesSection } from '@/components/filiados/dependentes-section';
import { abrirPdf } from '@/lib/pdf';

const HIST_ICON: Record<string, any> = {
  FILIACAO: UserPlus,
  ALTERACAO: RefreshCw,
  RECADASTRAMENTO: RefreshCw,
  MUDANCA_STATUS: ShieldCheck,
  INCLUSAO_DEPENDENTE: Baby,
  EXCLUSAO_DEPENDENTE: Baby,
  UPLOAD_DOCUMENTO: FileText,
  GERACAO_CARTEIRINHA: CreditCard,
  GERACAO_TERMO: FileSignature,
};

function Info({ label, valor }: { label: string; valor?: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{valor || '-'}</p>
    </div>
  );
}

export default function PerfilFiliadoPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [qrAberto, setQrAberto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: f, isLoading } = useQuery({
    queryKey: ['filiado', id],
    queryFn: async () => (await api.get(`/filiados/${id}`)).data,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['filiado', id] });

  const mudarSituacao = useMutation({
    mutationFn: async (situacao: string) => api.patch(`/filiados/${id}/situacao`, { situacao }),
    onSuccess: () => { toast.success('Situação atualizada'); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao alterar situação'),
  });

  const emitirCarteirinha = useMutation({
    mutationFn: async () => api.post(`/filiados/${id}/carteirinha/emitir`),
    onSuccess: () => { toast.success('Carteirinha emitida'); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao emitir'),
  });

  const uploadDoc = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('arquivo', file);
      fd.append('titulo', file.name);
      return api.post(`/filiados/${id}/documentos`, fd);
    },
    onSuccess: () => { toast.success('Documento anexado'); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao anexar'),
  });

  const removeDoc = useMutation({
    mutationFn: async (docId: string) => api.delete(`/filiados/${id}/documentos/${docId}`),
    onSuccess: () => { toast.success('Documento removido'); invalidar(); },
  });

  if (isLoading || !f) {
    return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/filiados" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="flex items-center gap-4">
            {f.fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.fotoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-senatepi-50 text-xl font-bold text-senatepi-800">{f.nomeCompleto.charAt(0)}</div>
            )}
            <div>
              <h2 className="text-2xl font-bold">{f.nomeCompleto}</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{f.matricula}</span>·<span>{f.formacao ? FORMACAO_LABEL[f.formacao as keyof typeof FORMACAO_LABEL] : '-'}</span>
                <Badge className={SITUACAO_COR[f.situacao as keyof typeof SITUACAO_COR]}>{SITUACAO_LABEL[f.situacao as keyof typeof SITUACAO_LABEL]}</Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setQrAberto(true)}><QrIcon className="h-4 w-4" /> QR</Button>
          <Button variant="outline" onClick={() => abrirPdf(`/filiados/${f.id}/termo/pdf`)}><FileText className="h-4 w-4" /> Termo</Button>
          <Button variant="secondary" onClick={() => abrirPdf(`/filiados/${f.id}/carteirinha/pdf`)}><IdCard className="h-4 w-4" /> Carteirinha</Button>
          <Link href={`/filiados/${f.id}/recadastrar`}><Button variant="outline"><RefreshCw className="h-4 w-4" /> Recadastrar</Button></Link>
          <Link href={`/filiados/${f.id}/editar`}><Button><Pencil className="h-4 w-4" /> Editar</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Dados pessoais</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="CPF" valor={mascararCpf(f.cpf)} />
              <Info label="RG" valor={`${f.rg ?? '-'}${f.ufRg ? ' / ' + f.ufRg : ''}`} />
              <Info label="Nascimento" valor={formatarData(f.dataNascimento)} />
              <Info label="Sexo" valor={f.sexo} />
              <Info label="Estado civil" valor={f.estadoCivil} />
              <Info label="Naturalidade" valor={f.naturalidade} />
              <Info label="Telefone" valor={f.telefonePrincipal} />
              <Info label="Telefone 2" valor={f.telefoneSecundario} />
              <Info label="E-mail" valor={f.email} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Dados profissionais</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Info label="Formação" valor={f.formacao === 'OUTRO' ? (f.formacaoOutro || 'Outro') : (f.formacao ? FORMACAO_LABEL[f.formacao as keyof typeof FORMACAO_LABEL] : '-')} />
                <Info label="COREN" valor={f.numeroCoren} />
                <Info label="Admissão" valor={formatarData(f.dataAdmissao)} />
              </div>
              {f.vinculos?.length > 0 && (
                <div className="space-y-2">
                  {f.vinculos.map((v: any, i: number) => (
                    <div key={v.id} className="rounded-lg border p-3 text-sm">
                      <p className="text-xs uppercase text-muted-foreground">Vínculo {i + 1}</p>
                      <p className="font-medium">{v.empresa}</p>
                      <p className="text-muted-foreground">{[v.cargo, v.matricula].filter(Boolean).join(' · ') || '-'}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Endereço</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="CEP" valor={f.cep} />
              <Info label="Endereço" valor={f.endereco} />
              <Info label="Número" valor={f.numero} />
              <Info label="Complemento" valor={f.complemento} />
              <Info label="Bairro" valor={f.bairro} />
              <Info label="Cidade" valor={f.cidade} />
              <Info label="Estado" valor={f.estado} />
            </CardContent>
          </Card>

          <DependentesSection filiadoId={f.id} dependentes={f.dependentes ?? []} />

          {/* Documentos */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Documentos anexados</CardTitle>
              <>
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadDoc.mutate(file); e.target.value = ''; }} />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadDoc.isPending}>
                  {uploadDoc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Anexar
                </Button>
              </>
            </CardHeader>
            <CardContent className="space-y-2">
              {f.documentos?.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum documento anexado</p>}
              {f.documentos?.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border p-3">
                  <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium hover:underline">
                    <FileText className="h-4 w-4 text-senatepi-800" /> {d.titulo}
                  </a>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{formatarData(d.createdAt)}</span>
                    <Button variant="ghost" size="icon" onClick={() => removeDoc.mutate(d.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">Formatos: PDF, DOC, DOCX, JPG, PNG (RG, CPF, comprovante, COREN, contracheque...).</p>
            </CardContent>
          </Card>
        </div>

        {/* Coluna lateral */}
        <div className="space-y-6">
          {/* Situação cadastral */}
          <Card>
            <CardHeader><CardTitle>Situação cadastral</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className={SITUACAO_COR[f.situacao as keyof typeof SITUACAO_COR]}>
                  {SITUACAO_LABEL[f.situacao as keyof typeof SITUACAO_LABEL]}
                </Badge>
                {mudarSituacao.isPending && <Loader2 className="h-4 w-4 animate-spin text-senatepi-800" />}
              </div>
              <div>
                <label className="text-xs uppercase text-muted-foreground">Alterar situação</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={f.situacao}
                  disabled={mudarSituacao.isPending}
                  onChange={(e) => { if (e.target.value !== f.situacao) mudarSituacao.mutate(e.target.value); }}
                >
                  {SITUACOES.map((s) => <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>)}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">A alteração fica registrada no histórico.</p>
              </div>
            </CardContent>
          </Card>

          {/* Carteirinha */}
          <Card>
            <CardHeader><CardTitle>Carteirinha digital</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {f.carteirinha ? (
                <>
                  <Info label="Número" valor={f.carteirinha.numero} />
                  <Info label="Emitida em" valor={formatarData(f.carteirinha.emitidaEm)} />
                  <Info label="Válida até" valor={formatarData(f.carteirinha.validaAte)} />
                  <Button className="w-full" onClick={() => abrirPdf(`/filiados/${f.id}/carteirinha/pdf`)}><IdCard className="h-4 w-4" /> Ver / Baixar PDF</Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {f.situacao === 'ATIVO'
                      ? 'Carteirinha ainda não emitida.'
                      : 'A carteirinha só pode ser emitida para filiado ATIVO.'}
                  </p>
                  <Button className="w-full" disabled={f.situacao !== 'ATIVO' || emitirCarteirinha.isPending} onClick={() => emitirCarteirinha.mutate()}>
                    {emitirCarteirinha.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <IdCard className="h-4 w-4" />} Emitir carteirinha
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Termos gerados */}
          <Card>
            <CardHeader><CardTitle>Termos gerados</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {f.termos?.length ? (
                f.termos.map((t: any) => (
                  <a key={t.id} href={t.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border p-2 text-sm hover:underline">
                    <FileSignature className="h-4 w-4 text-senatepi-800" /> {t.titulo}
                  </a>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum termo arquivado. Use o botão “Termo” para gerar.</p>
              )}
            </CardContent>
          </Card>

          {/* Histórico */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Histórico</CardTitle></CardHeader>
            <CardContent>
              <ol className="relative space-y-5 border-l border-border pl-5">
                {f.historico?.map((h: any) => {
                  const Icon = HIST_ICON[h.tipo] ?? Clock;
                  return (
                    <li key={h.id} className="relative">
                      <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-senatepi-50 ring-2 ring-background">
                        <Icon className="h-3 w-3 text-senatepi-800" />
                      </span>
                      <p className="text-sm font-medium">{h.descricao}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(h.createdAt).toLocaleString('pt-BR')}{h.autor ? ` · ${h.autor}` : ''}
                      </p>
                    </li>
                  );
                })}
                {f.historico?.length === 0 && <li className="text-sm text-muted-foreground">Sem registros.</li>}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      {qrAberto && <QrCodeDialog endpoint={`/filiados/${f.id}/qrcode`} titulo="QR Code do filiado" onClose={() => setQrAberto(false)} />}
    </div>
  );
}
