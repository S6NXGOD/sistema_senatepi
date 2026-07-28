'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, User, Phone, Mail, MapPin, UserCog, Clock, ArrowRight, History,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import { AtualizacaoCadastralModal } from '@/components/atendimentos/atualizacao-cadastral-modal';
import {
  getAtendimento, linkWhatsApp, mensagemSaudacao, formatDataHora,
  CANAL_LABEL, CANAL_COR, DESFECHO_LABEL, DESFECHO_COR, SETOR_LABEL,
} from '@/lib/atendimentos';
import { mascararCpf } from '@/lib/utils';

export function AtendimentoDrawer({
  atendimentoId, open, onClose, onMudou,
}: { atendimentoId: string | null; open: boolean; onClose: () => void; onMudou?: () => void }) {
  const qc = useQueryClient();
  const [cadastral, setCadastral] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['atendimento', atendimentoId],
    queryFn: () => getAtendimento(atendimentoId!),
    enabled: open && !!atendimentoId,
  });

  const at = data?.atendimento;
  const filiado = at?.filiado;
  const encaminhado = at?.desfecho === 'ENCAMINHADO';

  function abrirWhatsApp() {
    if (!filiado || !at) return;
    const url = linkWhatsApp(filiado.telefonePrincipal, mensagemSaudacao({ nome: filiado.nomeCompleto, data: at.createdAt }));
    if (!url) return toast.error('Filiado sem telefone válido para WhatsApp.');
    window.open(url, '_blank');
  }

  const Linha = ({ Icon, children }: { Icon: any; children: React.ReactNode }) => (
    <p className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> {children}</p>
  );

  return (
    <>
      <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-lg">
        <div className="flex items-center justify-between border-b p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Atendimento</p>
            <h3 className="truncate text-lg font-bold">{filiado?.nomeCompleto ?? 'Carregando…'}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {isLoading || !at || !filiado ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {/* Filiado */}
            <div className="rounded-xl border p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold"><User className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> Filiado</p>
                <Badge className="bg-muted text-muted-foreground">Matrícula {filiado.matricula}</Badge>
              </div>
              <div className="space-y-1.5">
                <Linha Icon={User}>{mascararCpf(filiado.cpf ?? '')}</Linha>
                <Linha Icon={Phone}>{filiado.telefonePrincipal || <span className="text-muted-foreground">sem telefone</span>}</Linha>
                <Linha Icon={Mail}>{filiado.email || <span className="text-muted-foreground">sem e-mail</span>}</Linha>
                <Linha Icon={MapPin}>{[filiado.endereco, filiado.numero, filiado.bairro, filiado.cidade].filter(Boolean).join(', ') || <span className="text-muted-foreground">sem endereço</span>}</Linha>
              </div>
              {/* Ferramentas de produtividade */}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#20bd5a]" onClick={abrirWhatsApp}>
                  <WhatsAppIcon className="h-4 w-4" /> WhatsApp
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCadastral(true)}>
                  <UserCog className="h-4 w-4" /> Atualização cadastral
                </Button>
              </div>
            </div>

            {/* Dossiê do atendimento */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={CANAL_COR[at.canal]}>{CANAL_LABEL[at.canal]}</Badge>
                <Badge className={DESFECHO_COR[at.desfecho]}>{DESFECHO_LABEL[at.desfecho]}</Badge>
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {formatDataHora(at.createdAt)}</span>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Demanda</p>
                <p className="whitespace-pre-wrap text-sm">{at.descricao}</p>
              </div>
              {encaminhado && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Encaminhado para <strong>{at.setor ? SETOR_LABEL[at.setor] : '—'}</strong>
                    {at.responsavel ? <> — responsável: <strong>{at.responsavel}</strong></> : null}
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Registrado por <strong>{at.atendente.nome}</strong></p>
            </div>

            {/* Histórico do filiado */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4" /> Histórico do filiado</p>
              {data.historico.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum atendimento anterior.</p>
              ) : (
                <ul className="space-y-2">
                  {data.historico.map((h) => (
                    <li key={h.id} className="rounded-lg border p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge className={CANAL_COR[h.canal]}>{CANAL_LABEL[h.canal]}</Badge>
                        <Badge className={DESFECHO_COR[h.desfecho]}>{DESFECHO_LABEL[h.desfecho]}</Badge>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> {formatDataHora(h.createdAt)}</span>
                      </div>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{h.descricao}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {cadastral && filiado && (
        <AtualizacaoCadastralModal
          filiado={filiado}
          onClose={() => setCadastral(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['atendimento', atendimentoId] }); onMudou?.(); }}
        />
      )}
    </>
  );
}
