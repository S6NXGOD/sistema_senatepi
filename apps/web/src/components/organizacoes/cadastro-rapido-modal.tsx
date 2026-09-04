'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BuscaCnpj } from './busca-cnpj';
import { cn } from '@/lib/utils';
import {
  criarParteExterna, TIPO_PARTE_LABEL,
  type ConsultaCnpj, type ParteExterna, type ParteParecida, type TipoParteExterna,
} from '@/lib/partes';

/**
 * CADASTRAR A ORGANIZAÇÃO NA HORA, sem sair do processo.
 *
 * O QUE ISTO SUBSTITUI: a opção "Usar «X» como texto". Ela existia por um
 * motivo legítimo — há réu que aparece nos autos só pelo nome, sem documento —
 * mas era o caminho MAIS CURTO da tela, e caminho curto vira caminho padrão.
 * O resultado é o cadastro de organizações cheio de nomes soltos que não se
 * ligam a processo nenhum: "quantas ações temos contra a Unimed?" só responde
 * certo se as sete forem a MESMA Unimed.
 *
 * COM O CNPJ, O TRABALHO É DA RECEITA. Razão social, cidade, UF e a natureza
 * jurídica (que sugere se é empresa ou órgão público) vêm prontas — e a
 * consulta ainda avisa se a organização já existe aqui, que é a duplicata
 * chegando pela porta da frente.
 *
 * O CNPJ CONTINUA OPCIONAL. Exigir documento para cadastrar quebraria o caso
 * que motivou o texto livre. O que muda é a ordem: cadastrar é o botão, e usar
 * só o nome é a saída discreta ao lado.
 */
export function CadastroRapidoOrganizacaoModal({
  open,
  onClose,
  nomeInicial,
  onCriada,
  onUsarSoNome,
}: {
  open: boolean;
  onClose: () => void;
  /** O que foi digitado na busca — não se redigita nada. */
  nomeInicial?: string | null;
  onCriada: (p: ParteExterna) => void;
  /**
   * A saída para o réu que os autos trazem só pelo nome. Quando ausente, o
   * modal não oferece o atalho — é o chamador que sabe se ele faz sentido.
   */
  onUsarSoNome?: (nome: string) => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [tipo, setTipo] = useState<TipoParteExterna>('JURIDICA');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');

  useEffect(() => {
    if (!open) return;
    setNome((nomeInicial ?? '').trim());
    setDocumento('');
    setTipo('JURIDICA');
    setCidade('');
    setUf('');
  }, [open, nomeInicial]);

  /** A Receita respondeu: o formulário inteiro se preenche. */
  function preencherComReceita(d: ConsultaCnpj) {
    if (d.razaoSocial) setNome(d.razaoSocial);
    if (d.tipoSugerido) setTipo(d.tipoSugerido);
    if (d.cidade) setCidade(d.cidade);
    if (d.uf) setUf(d.uf);
    toast.success('Dados da Receita Federal preenchidos. Confira e salve.');
  }

  const criar = useMutation({
    mutationFn: () =>
      criarParteExterna({
        tipo,
        nome: nome.trim(),
        documento: documento.replace(/\D/g, '') || undefined,
        cidade: cidade.trim() || undefined,
        uf: uf.trim().toUpperCase() || undefined,
      }),
    onSuccess: (p) => {
      /*
        `organizacoes` é a chave que a tela de Organizações usa — escrevi
        `partes-externas` na primeira vez (o nome da rota) e a invalidação não
        pegava nada: a organização nascia aqui e a lista de lá só a mostrava
        depois de um F5.

        O autocomplete de réu não precisa: ele consulta a API a cada tecla,
        sem cache do React Query.
      */
      qc.invalidateQueries({ queryKey: ['organizacoes'] });
      toast.success('Organização cadastrada.');
      onCriada(p);
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : (m ?? 'Não foi possível cadastrar a organização.'));
    },
  });

  /** Escolheu um cadastro que já existia (mesmo CNPJ, ou parecido). */
  function usarExistente(p: ParteExterna | ParteParecida) {
    onCriada(p as ParteExterna);
  }

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;

  const podeSalvar = nome.trim().length >= 2 && !criar.isPending;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Cadastrar organização"
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-900/30">
              <Building2 className="h-4.5 w-4.5 text-brand-800 dark:text-brand-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold">Cadastrar organização</h3>
              <p className="text-xs text-muted-foreground">
                Ela entra no processo já vinculada, e fica no cadastro para as próximas.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {/*
            O CNPJ VEM PRIMEIRO, e de propósito: preenchido, ele resolve o resto
            do formulário sozinho. Deixá-lo depois do nome faria a pessoa
            digitar a razão social à mão para só então descobrir que não
            precisava.
          */}
          <BuscaCnpj
            valor={documento}
            onChange={setDocumento}
            onEncontrado={preencherComReceita}
            onAbrirExistente={usarExistente}
            rotulo="CNPJ"
          />

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="org-nome">
              Nome / razão social <span className="text-red-600">*</span>
            </label>
            <Input
              id="org-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Como a parte consta nos autos"
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="org-tipo">Tipo</label>
              <select
                id="org-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoParteExterna)}
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm"
              >
                {(Object.keys(TIPO_PARTE_LABEL) as TipoParteExterna[]).map((t) => (
                  <option key={t} value={t}>{TIPO_PARTE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="org-cidade">Cidade</label>
                <Input id="org-cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="org-uf">UF</label>
                <Input
                  id="org-uf"
                  value={uf}
                  maxLength={2}
                  onChange={(e) => setUf(e.target.value.toUpperCase())}
                  className="uppercase"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 p-4">
          {/*
            A SAÍDA SEM CADASTRO CONTINUA EXISTINDO — e continua sendo a
            secundária. É ela que atende o réu que os autos trazem só pelo nome;
            tirá-la obrigaria a inventar um CNPJ para conseguir seguir.
          */}
          {onUsarSoNome && (
            <button
              type="button"
              onClick={() => onUsarSoNome(nome.trim() || (nomeInicial ?? '').trim())}
              className={cn(
                'text-xs text-muted-foreground underline-offset-2 transition',
                'hover:text-foreground hover:underline',
              )}
            >
              Usar só o nome, sem cadastro
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={criar.isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => criar.mutate()} disabled={!podeSalvar}>
              {criar.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Cadastrando…</>
              ) : (
                <><Building2 className="h-4 w-4" /> Cadastrar</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
