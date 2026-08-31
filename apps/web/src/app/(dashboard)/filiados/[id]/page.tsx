'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Pencil, RefreshCw, IdCard, QrCode as QrIcon, FileText, Upload,
  Trash2, Loader2, Clock, UserPlus, ShieldCheck, FileSignature, CreditCard, Baby,
  History, Building2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatarData, mascararCpf, cn } from '@/lib/utils';
import {
  FORMACAO_LABEL, MODALIDADE_LABEL, SITUACAO_COR, SITUACAO_LABEL, SITUACOES,
  type ModalidadeContribuicao,
} from '@/lib/filiados';
import { useAuth } from '@/lib/auth';
import { podeExcluir } from '@/lib/permissoes';
import { QrCodeDialog } from '@/components/qrcode-dialog';
import { RecadastrarModal } from '@/components/filiados/recadastrar-modal';
import { DependentesSection } from '@/components/filiados/dependentes-section';
import { FinanceiroSection } from '@/components/filiados/financeiro-section';
import { DossieDrawer } from '@/components/filiados/dossie-drawer';
import { abrirPdf, baixarPdf } from '@/lib/pdf';
import { campoVisivel } from '@/tenant.config';
import { V } from '@/lib/vocabulario';

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
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  const [qrAberto, setQrAberto] = useState(false);
  const [recadastrarAberto, setRecadastrarAberto] = useState(false);
  const [dossieAberto, setDossieAberto] = useState(false);
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
    return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-brand-800" /></div>;
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
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-brand-50 text-xl font-bold text-brand-800">{f.nomeCompleto.charAt(0)}</div>
            )}
            <div>
              <h2 className="text-2xl font-bold">{f.nomeCompleto}</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{f.matricula}</span>
                {campoVisivel('formacao') && (
                  <>·<span>{f.formacao ? FORMACAO_LABEL[f.formacao as keyof typeof FORMACAO_LABEL] : '-'}</span></>
                )}
                <Badge className={SITUACAO_COR[f.situacao as keyof typeof SITUACAO_COR]}>{SITUACAO_LABEL[f.situacao as keyof typeof SITUACAO_LABEL]}</Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDossieAberto(true)}><History className="h-4 w-4" /> Dossiê</Button>
          <Button variant="outline" onClick={() => setQrAberto(true)}><QrIcon className="h-4 w-4" /> QR</Button>
          {/*
            BAIXAR, e não abrir numa aba. O `blob:` de uma aba nova não carrega
            nome nenhum, e o visualizador salva com o UUID do blob — era essa a
            queixa. Aqui a intenção é OBTER o documento (assinar, arquivar,
            mandar por e-mail), e nesse caso o nome vale mais que a
            pré-visualização, que o navegador oferece de qualquer forma ao
            abrir o arquivo baixado.
          */}
          <Button variant="outline" onClick={() => baixarPdf(`/filiados/${f.id}/termo/pdf`)}><FileText className="h-4 w-4" /> Baixar Termo</Button>
          <Button variant="secondary" onClick={() => baixarPdf(`/filiados/${f.id}/carteirinha/pdf`)}><IdCard className="h-4 w-4" /> Carteirinha</Button>
          {/* Abre a escolha: presencial (equipe) ou link de 24h para o filiado */}
          <Button variant="outline" onClick={() => setRecadastrarAberto(true)}>
            <RefreshCw className="h-4 w-4" /> Recadastrar
          </Button>
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
                {campoVisivel('formacao') && (
                  <Info label="Formação" valor={f.formacao === 'OUTRO' ? (f.formacaoOutro || 'Outro') : (f.formacao ? FORMACAO_LABEL[f.formacao as keyof typeof FORMACAO_LABEL] : '-')} />
                )}
                {campoVisivel('numeroCoren') && <Info label="COREN" valor={f.numeroCoren} />}
                <Info label="Admissão" valor={formatarData(f.dataAdmissao)} />
                <Info
                  label="Contribuição"
                  valor={
                    f.modalidadeContribuicao
                      ? MODALIDADE_LABEL[f.modalidadeContribuicao as ModalidadeContribuicao]
                      : null
                  }
                />
              </div>

              {/* Locais de trabalho. O selo de desconto em folha é destaque
                  porque é a pergunta do financeiro: onde a mensalidade sai? */}
              {f.vinculos?.length > 0 ? (
                <div className="space-y-2">
                  {/* "Vínculos profissionais", e não "Locais de trabalho": o
                      LOCAL de trabalho é a lotação (a escola, o hospital), que
                      fica DENTRO do empregador. Chamar o bloco inteiro de
                      "local de trabalho" colidia com o campo lotação e fazia a
                      secretaria procurar a escola no lugar do órgão. O nome
                      agora é o mesmo do formulário e o do próprio model. */}
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Vínculos profissionais ({f.vinculos.length})
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {f.vinculos.map((v: any) => (
                      <div
                        key={v.id}
                        className={cn(
                          'rounded-lg border p-3 text-sm',
                          v.descontoEmFolha
                            ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-900/10'
                            : 'bg-card',
                        )}
                      >
                        <p className="flex items-start justify-between gap-2 font-medium">
                          <span className="min-w-0 truncate">{v.empresa}</span>
                          {v.parteExternaId && (
                            <Building2
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-label="Vinculado ao cadastro de organizações"
                            />
                          )}
                        </p>
                        {/**
                          * A LOTAÇÃO ESTAVA NO BANCO E NÃO APARECIA AQUI.
                          *
                          * O card mostrava empregador, cargo e matrícula, e
                          * pulava justamente a lotação — que num sindicato de
                          * servidores é o dado mais consultado: é a escola, o
                          * CMEI, a unidade de saúde onde a pessoa trabalha. A
                          * secretaria concluía que a importação tinha perdido a
                          * informação; ela estava gravada desde sempre.
                          *
                          * Ganha linha PRÓPRIA, e não mais um item na lista
                          * separada por "·": é o segundo nível da hierarquia
                          * (órgão → lotação), e achatá-lo ao lado do cargo
                          * esconde essa relação.
                          */}
                        {v.lotacao && (
                          <p className="truncate text-xs font-medium text-foreground/80">
                            {v.lotacao}
                          </p>
                        )}
                        <p className="truncate text-xs text-muted-foreground">
                          {[v.cargo, v.matricula && `${V.Matricula} ${v.matricula}`]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </p>
                        {v.descontoEmFolha && (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
                            💳 Desconto em Folha
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Incoerência que o financeiro sofreria calado. */}
                  {f.modalidadeContribuicao === 'DESCONTO_FOLHA' &&
                    !f.vinculos.some((v: any) => v.descontoEmFolha) && (
                      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
                        Contribui por <strong>desconto em folha</strong>, mas nenhum local está
                        marcado — edite o cadastro e indique em qual folha o desconto ocorre.
                      </p>
                    )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Nenhum local de trabalho cadastrado.
                </p>
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

          <FinanceiroSection filiado={{ id: f.id, nomeCompleto: f.nomeCompleto, matricula: f.matricula, telefonePrincipal: f.telefonePrincipal }} />

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
                    <FileText className="h-4 w-4 text-brand-800" /> {d.titulo}
                  </a>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{formatarData(d.createdAt)}</span>
                    {/* Só o Administrador apaga — regra global do sistema. */}
                    {ehAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => removeDoc.mutate(d.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
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
                {mudarSituacao.isPending && <Loader2 className="h-4 w-4 animate-spin text-brand-800" />}
              </div>
              <div>
                <label className="text-xs uppercase text-muted-foreground">Alterar situação</label>
                <select
                  className="mt-1 h-12 w-full rounded-md border border-input md:h-10 bg-background px-3 text-base md:text-sm"
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
                  {/*
                    Dois botões, porque são duas intenções. "Ver" abre na aba e
                    o arquivo não tem nome — serve para conferir a foto antes de
                    imprimir. "Baixar" entrega com o nome do filiado.
                  */}
                  <div className="flex w-full gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => abrirPdf(`/filiados/${f.id}/carteirinha/pdf`)}>Ver</Button>
                    <Button className="flex-1" onClick={() => baixarPdf(`/filiados/${f.id}/carteirinha/pdf`)}><IdCard className="h-4 w-4" /> Baixar</Button>
                  </div>
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
                    <FileSignature className="h-4 w-4 text-brand-800" /> {t.titulo}
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
                      <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-brand-50 ring-2 ring-background">
                        <Icon className="h-3 w-3 text-brand-800" />
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

      <RecadastrarModal
        open={recadastrarAberto}
        onClose={() => setRecadastrarAberto(false)}
        filiadoId={f.id}
        filiadoNome={f.nomeCompleto}
      />

      {/* Dossiê — o histórico consolidado (triagem, agenda, processos, financeiro) */}
      <DossieDrawer
        filiadoId={dossieAberto ? f.id : null}
        open={dossieAberto}
        onClose={() => setDossieAberto(false)}
      />
    </div>
  );
}
