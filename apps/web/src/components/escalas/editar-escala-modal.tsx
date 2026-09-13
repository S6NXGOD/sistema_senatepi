'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeftRight, Loader2, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDataPura } from '@/lib/data-pura';
import { SeletorDePessoa } from './seletor-de-pessoa';
import {
  AdvogadoEscala, AlteracaoDeEscala, Escala, atualizarEscala, diaCurto, faixaDoPlantao, mensagemDoErro,
  nomeDeExibicao, planejarAlteracao,
} from '@/lib/escalas';

export type ModoDaEdicao = 'editar' | 'trocar';

/**
 * CORRIGIR OU TROCAR um plantão (PATCH /escalas/:id).
 *
 * "Trocar com…" é só mudar a pessoa: com cinco advogados, a troca se combina no
 * corredor e alguém registra. A data não muda aqui — plantão em outro dia é
 * outro plantão.
 */
export function EditarEscalaModal({
  alvo,
  pessoas,
  carregandoPessoas = false,
  onClose,
  onSalvo,
}: {
  alvo: { escala: Escala; modo: ModoDaEdicao } | null;
  pessoas: AdvogadoEscala[];
  carregandoPessoas?: boolean;
  onClose: () => void;
  onSalvo: () => void;
}) {
  if (!alvo) return null;
  return (
    <FormularioDaEdicao
      key={`${alvo.escala.id}-${alvo.modo}`}
      escala={alvo.escala}
      modo={alvo.modo}
      pessoas={pessoas}
      carregandoPessoas={carregandoPessoas}
      onClose={onClose}
      onSalvo={onSalvo}
    />
  );
}

function FormularioDaEdicao({
  escala, modo, pessoas, carregandoPessoas, onClose, onSalvo,
}: {
  escala: Escala;
  modo: ModoDaEdicao;
  pessoas: AdvogadoEscala[];
  carregandoPessoas: boolean;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const trocar = modo === 'trocar';
  const pessoaAtualId = escala.advogadoId ?? escala.advogado.id;
  const [advogadoId, setAdvogadoId] = useState(trocar ? '' : pessoaAtualId);
  const [horaInicio, setHoraInicio] = useState(escala.horaInicio);
  const [horaFim, setHoraFim] = useState(escala.horaFim);
  const [observacao, setObservacao] = useState(escala.observacao ?? '');
  const [erro, setErro] = useState<string | null>(null);

  // Quem está no plantão pode ter sido desativado depois: continua no seletor
  // da edição, senão o campo apareceria vazio.
  const lista = useMemo(
    () => (pessoas.some((p) => p.id === escala.advogado.id) ? pessoas : [...pessoas, escala.advogado]),
    [pessoas, escala.advogado],
  );

  const plano = planejarAlteracao(escala, { advogadoId, horaInicio, horaFim, observacao });

  const salvar = useMutation({
    mutationFn: (dados: AlteracaoDeEscala) => atualizarEscala(escala.id, dados),
    onSuccess: (atualizada, dados) => {
      if (dados.advogadoId) {
        const quem = atualizada?.advogado ?? lista.find((p) => p.id === dados.advogadoId);
        toast.success(`${quem ? nomeDeExibicao(quem) : 'A nova pessoa'} assumiu o plantão de ${diaCurto(escala.data)}.`);
      } else {
        toast.success('Plantão atualizado.');
      }
      onSalvo();
      onClose();
    },
    onError: (e) => setErro(mensagemDoErro(e, 'Não foi possível salvar. Tente de novo.')),
  });

  function submeter() {
    if (trocar && !advogadoId) return setErro('Escolha quem vai assumir o plantão.');
    if (!horaInicio || !horaFim || horaFim <= horaInicio) {
      return setErro(`Em ${diaCurto(escala.data)}, a hora de fim deve ser depois da de início.`);
    }
    if (!plano) return onClose();
    setErro(null);
    salvar.mutate(plano);
  }

  const dia = formatDataPura(escala.data, { weekday: 'long', day: '2-digit', month: '2-digit' });
  const Icone = trocar ? ArrowLeftRight : Pencil;
  const tituloId = `editar-escala-${escala.id}`;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="flex max-h-[92vh] w-full max-w-md animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <Icone className="h-5 w-5 text-brand-800 dark:text-brand-400" />
            </div>
            <div className="min-w-0">
              <h3 id={tituloId} className="text-lg font-bold">{trocar ? 'Trocar plantão' : 'Editar plantão'}</h3>
              <p className="text-sm text-muted-foreground">
                <span className="first-letter:uppercase">{dia}</span> · <span className="tabular-nums">{faixaDoPlantao(escala)}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={salvar.isPending}
            aria-label="Fechar"
            className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {trocar ? (
            <>
              <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                Hoje o plantão está com <strong className="font-semibold">{nomeDeExibicao(escala.advogado)}</strong>.
              </p>
              <div className="space-y-1.5">
                <label htmlFor="troca-pessoa" className="text-sm font-medium">Quem assume o plantão *</label>
                <SeletorDePessoa
                  id="troca-pessoa"
                  value={advogadoId}
                  onChange={(v) => { setErro(null); setAdvogadoId(v); }}
                  pessoas={lista}
                  excluirId={pessoaAtualId}
                  carregando={carregandoPessoas}
                  placeholder="Escolher pessoa…"
                />
                <p className="text-xs text-muted-foreground">
                  O horário continua {faixaDoPlantao(escala)}. Para mudar o horário, use Editar.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="edicao-pessoa" className="text-sm font-medium">Quem fica de plantão *</label>
                <SeletorDePessoa
                  id="edicao-pessoa"
                  value={advogadoId}
                  onChange={(v) => { setErro(null); setAdvogadoId(v); }}
                  pessoas={lista}
                  carregando={carregandoPessoas}
                  placeholder="Escolher pessoa…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="edicao-inicio" className="text-sm font-medium">Início *</label>
                  <Input id="edicao-inicio" type="time" value={horaInicio} onChange={(e) => { setErro(null); setHoraInicio(e.target.value); }} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="edicao-fim" className="text-sm font-medium">Fim *</label>
                  <Input id="edicao-fim" type="time" value={horaFim} onChange={(e) => { setErro(null); setHoraFim(e.target.value); }} />
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label htmlFor="edicao-obs" className="text-sm font-medium">Observação</label>
            <Input
              id="edicao-obs"
              placeholder={trocar ? 'Ex.: troca combinada entre os dois' : 'Opcional'}
              maxLength={500}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>

          {!trocar && (
            <p className="text-xs text-muted-foreground">A data não muda aqui. Para outro dia, cadastre um plantão novo.</p>
          )}

          {erro && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {erro}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button className="flex-1 sm:flex-none" onClick={submeter} disabled={salvar.isPending || !plano}>
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {trocar ? 'Passar o plantão' : 'Salvar alterações'}
          </Button>
        </div>
      </div>
    </div>
  );
}
