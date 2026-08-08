'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, Loader2, Plus, Users, Vote } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import {
  CHAVES_CONFIG, STATUS_EVENTO_COR, STATUS_EVENTO_LABEL, TIPO_EVENTO_LABEL,
  criarEvento, listarEventos,
  type ConfiguracoesEvento, type TipoEvento,
} from '@/lib/eventos';

const TIPOS: TipoEvento[] = [
  'ASSEMBLEIA', 'CONGRESSO', 'REUNIAO', 'CURSO', 'SORTEIO',
  'NEGOCIACAO', 'EVENTO_SOCIAL', 'EVENTO_ESPORTIVO', 'OUTRO',
];

/**
 * Sugestão de configuração por tipo.
 *
 * O tipo é RÓTULO, não comportamento — quem decide o que o evento faz são as
 * chaves. Mas ninguém quer marcar seis caixas à mão toda vez: ao escolher o
 * tipo, as chaves típicas vêm marcadas e podem ser desmarcadas à vontade.
 */
const SUGESTAO: Partial<Record<TipoEvento, Partial<ConfiguracoesEvento>>> = {
  ASSEMBLEIA: { habilitarVotacao: true, exigeAdimplencia: true },
  CONGRESSO: { habilitarVotacao: true, gerarCertificado: true },
  CURSO: { gerarCertificado: true },
  SORTEIO: { habilitarSorteio: true },
  EVENTO_SOCIAL: { permiteDependente: true, habilitarSorteio: true },
  EVENTO_ESPORTIVO: { permiteDependente: true },
};

export default function EventosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const pode = podeEditar(user?.role, user?.permissoes, 'eventos');
  const [criando, setCriando] = useState(false);

  const { data: eventos, isLoading } = useQuery({
    queryKey: ['eventos'],
    queryFn: listarEventos,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Eventos</h2>
          <p className="text-sm text-muted-foreground">
            Assembleias, cursos e sorteios — presenciais ou pelo Plenário Virtual
          </p>
        </div>
        {pode && (
          <Button onClick={() => setCriando((v) => !v)}>
            <Plus className="h-4 w-4" /> Novo evento
          </Button>
        )}
      </div>

      {criando && (
        <FormNovoEvento
          onCriado={() => {
            setCriando(false);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
          onCancelar={() => setCriando(false)}
        />
      )}

      {isLoading && (
        <Card><CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </CardContent></Card>
      )}

      {!isLoading && eventos?.length === 0 && (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">Nenhum evento cadastrado</p>
        </CardContent></Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {eventos?.map((e) => (
          <Link key={e.id} href={`/eventos/${e.id}`}>
            <Card className="h-full transition hover:border-brand-400">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Badge className={STATUS_EVENTO_COR[e.status]}>
                    {STATUS_EVENTO_LABEL[e.status]}
                  </Badge>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {TIPO_EVENTO_LABEL[e.tipo]}
                  </span>
                </div>
                <p className="font-semibold leading-tight">{e.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.dataInicio).toLocaleString('pt-BR', {
                    dateStyle: 'short', timeStyle: 'short',
                  })}
                </p>
                <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {e._count?.presencas ?? 0}
                  </span>
                  {e.configuracoes?.habilitarVotacao && (
                    <span className="flex items-center gap-1">
                      <Vote className="h-3.5 w-3.5" /> votação
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function FormNovoEvento({
  onCriado, onCancelar,
}: { onCriado: () => void; onCancelar: () => void }) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoEvento>('ASSEMBLEIA');
  const [dataInicio, setDataInicio] = useState('');
  const [linkReuniao, setLinkReuniao] = useState('');
  const [cfg, setCfg] = useState<Partial<ConfiguracoesEvento>>(SUGESTAO.ASSEMBLEIA ?? {});
  const [salvando, setSalvando] = useState(false);

  function trocarTipo(t: TipoEvento) {
    setTipo(t);
    // Substitui a sugestão anterior em vez de somar: acumular deixaria ligadas
    // chaves de um tipo que a pessoa nem escolheu.
    setCfg(SUGESTAO[t] ?? {});
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      await criarEvento({
        nome,
        tipo,
        dataInicio: new Date(dataInicio).toISOString(),
        linkReuniao: linkReuniao.trim() || undefined,
        configuracoes: cfg as ConfiguracoesEvento,
      });
      toast.success('Evento criado.');
      onCriado();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível criar o evento.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <form
          onSubmit={salvar}
          // Enter em campo de texto não envia: mesmo motivo do cadastro de
          // filiados — o formulário tem várias seções e o gesto natural depois
          // de colar o link é apertar Enter.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
              e.preventDefault();
            }
          }}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium">Nome do evento</label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo</label>
              <select
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
                value={tipo}
                onChange={(e) => trocarTipo(e.target.value as TipoEvento)}
              >
                {TIPOS.map((t) => <option key={t} value={t}>{TIPO_EVENTO_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Início</label>
              <Input
                type="datetime-local"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium">Link da reunião (opcional)</label>
              <Input
                placeholder="https://meet.google.com/..."
                value={linkReuniao}
                onChange={(e) => setLinkReuniao(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Meet, Zoom ou Teams. Só é mostrado a quem fizer check-in.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Como este evento funciona</p>
            {CHAVES_CONFIG.map(({ chave, rotulo, ajuda }) => (
              <label key={chave} className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 accent-brand-800"
                  checked={!!cfg[chave]}
                  onChange={(e) => setCfg((c) => ({ ...c, [chave]: e.target.checked }))}
                />
                <span>
                  {rotulo}
                  <span className="block text-xs text-muted-foreground">{ajuda}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancelar}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Criar evento
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
