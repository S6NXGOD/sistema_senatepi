'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Pencil,
  IdCard,
  QrCode as QrIcon,
  Upload,
  FileText,
  Trash2,
  Loader2,
  Clock,
  UserPlus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatarData, mascararCpf } from '@/lib/utils';
import { STATUS, STATUS_COR, STATUS_LABEL, TIPO_LABEL } from '@/lib/funcionarios';
import { QrCodeDialog } from '@/components/funcionarios/qrcode-dialog';

import { abrirPdf } from '@/lib/pdf';

const HIST_ICON: Record<string, any> = {
  CADASTRO: UserPlus,
  ALTERACAO: RefreshCw,
  MUDANCA_STATUS: ShieldCheck,
  UPLOAD_DOCUMENTO: FileText,
  GERACAO_CARTEIRINHA: IdCard,
  GERACAO_QRCODE: QrIcon,
};

function Info({ label, valor }: { label: string; valor?: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{valor || '-'}</p>
    </div>
  );
}

export default function PerfilFuncionarioPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [qrAberto, setQrAberto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: f, isLoading } = useQuery({
    queryKey: ['funcionario', id],
    queryFn: async () => (await api.get(`/funcionarios/${id}`)).data,
  });

  const mudarStatus = useMutation({
    mutationFn: async (status: string) => api.patch(`/funcionarios/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status atualizado');
      qc.invalidateQueries({ queryKey: ['funcionario', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao alterar status'),
  });

  const uploadDoc = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('arquivo', file);
      fd.append('titulo', file.name);
      return api.post(`/funcionarios/${id}/documentos`, fd);
    },
    onSuccess: () => {
      toast.success('Documento anexado');
      qc.invalidateQueries({ queryKey: ['funcionario', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao anexar'),
  });

  const removeDoc = useMutation({
    mutationFn: async (docId: string) => api.delete(`/funcionarios/${id}/documentos/${docId}`),
    onSuccess: () => {
      toast.success('Documento removido');
      qc.invalidateQueries({ queryKey: ['funcionario', id] });
    },
  });

  if (isLoading || !f) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-senatepi-800" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/funcionarios" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-4">
            {f.fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.fotoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-senatepi-50 text-xl font-bold text-senatepi-800">
                {f.nome.charAt(0)}
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold">{f.nome}</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{f.matricula}</span>·<span>{TIPO_LABEL[f.tipo as keyof typeof TIPO_LABEL]}</span>
                <Badge className={STATUS_COR[f.status as keyof typeof STATUS_COR]}>
                  {STATUS_LABEL[f.status as keyof typeof STATUS_LABEL]}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setQrAberto(true)}><QrIcon className="h-4 w-4" /> QR Code</Button>
          <Button variant="secondary" onClick={() => abrirPdf(`/funcionarios/${f.id}/carteirinha/pdf`)}><IdCard className="h-4 w-4" /> Carteirinha</Button>
          <Link href={`/funcionarios/${f.id}/editar`}><Button><Pencil className="h-4 w-4" /> Editar</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Coluna principal */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Dados pessoais</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="CPF" valor={mascararCpf(f.cpf)} />
              <Info label="Nascimento" valor={formatarData(f.dataNascimento)} />
              <Info label="Telefone" valor={f.telefone} />
              <Info label="E-mail" valor={f.email} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Dados funcionais</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="Cargo" valor={f.cargo} />
              <Info label="Departamento" valor={f.departamento} />
              <Info label="Tipo" valor={TIPO_LABEL[f.tipo as keyof typeof TIPO_LABEL]} />
              <Info label="Admissão" valor={formatarData(f.dataAdmissao)} />
              <Info label="Status" valor={STATUS_LABEL[f.status as keyof typeof STATUS_LABEL]} />
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

          {/* Documentos */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Documentos anexados</CardTitle>
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadDoc.mutate(file);
                    e.target.value = '';
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadDoc.isPending}>
                  {uploadDoc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Anexar
                </Button>
              </>
            </CardHeader>
            <CardContent className="space-y-2">
              {f.documentos?.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">Nenhum documento anexado</p>
              )}
              {f.documentos?.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border p-3">
                  <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium hover:underline">
                    <FileText className="h-4 w-4 text-senatepi-800" /> {d.titulo}
                  </a>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{formatarData(d.createdAt)}</span>
                    <Button variant="ghost" size="icon" onClick={() => removeDoc.mutate(d.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">Formatos: PDF, DOC, DOCX, JPG, PNG.</p>
            </CardContent>
          </Card>
        </div>

        {/* Coluna lateral */}
        <div className="space-y-6">
          {/* Status */}
          <Card>
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className={STATUS_COR[f.status as keyof typeof STATUS_COR]}>
                  {STATUS_LABEL[f.status as keyof typeof STATUS_LABEL]}
                </Badge>
                {mudarStatus.isPending && <Loader2 className="h-4 w-4 animate-spin text-senatepi-800" />}
              </div>
              <div>
                <label className="text-xs uppercase text-muted-foreground">Alterar status</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={f.status}
                  disabled={mudarStatus.isPending}
                  onChange={(e) => { if (e.target.value !== f.status) mudarStatus.mutate(e.target.value); }}
                >
                  {STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">A alteração fica registrada no histórico.</p>
              </div>
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
                        {new Date(h.createdAt).toLocaleString('pt-BR')}
                        {h.autor ? ` · ${h.autor}` : ''}
                      </p>
                    </li>
                  );
                })}
                {f.historico?.length === 0 && (
                  <li className="text-sm text-muted-foreground">Sem registros.</li>
                )}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      {qrAberto && <QrCodeDialog funcionarioId={f.id} onClose={() => setQrAberto(false)} />}
    </div>
  );
}
