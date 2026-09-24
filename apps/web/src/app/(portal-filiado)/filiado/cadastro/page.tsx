'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Lock, Save } from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import {
  ErroPortal,
  buscarMeuCadastro,
  salvarMeuCadastro,
  type MeuCadastro,
} from '@/lib/portal-filiado';
import { formatDataPura } from '@/lib/data-pura';
import { mascararCpfLgpd } from '@/lib/colonia';
import { tenant } from '@/tenant.config';

/** Rótulo e formato de cada campo editável — a ORDEM é a de um envelope. */
const CAMPOS: Array<{
  chave: string;
  rotulo: string;
  tipo?: string;
  modo?: 'numeric' | 'tel' | 'email';
  largura?: 'cheia' | 'meia' | 'curta';
  dica?: string;
}> = [
  { chave: 'endereco', rotulo: 'Endereço', largura: 'cheia' },
  { chave: 'numero', rotulo: 'Número', largura: 'curta', modo: 'numeric' },
  { chave: 'complemento', rotulo: 'Complemento', largura: 'meia' },
  { chave: 'bairro', rotulo: 'Bairro', largura: 'meia' },
  { chave: 'cidade', rotulo: 'Cidade', largura: 'meia' },
  { chave: 'estado', rotulo: 'UF', largura: 'curta' },
  { chave: 'cep', rotulo: 'CEP', largura: 'meia', modo: 'numeric' },
  { chave: 'telefonePrincipal', rotulo: 'Telefone', largura: 'meia', modo: 'tel' },
  { chave: 'telefoneSecundario', rotulo: 'Outro telefone', largura: 'meia', modo: 'tel' },
  {
    chave: 'email',
    rotulo: 'E-mail',
    largura: 'cheia',
    tipo: 'email',
    modo: 'email',
    dica: 'Deixe em branco se não usar.',
  },
];

const LARGURA = { cheia: 'sm:col-span-6', meia: 'sm:col-span-3', curta: 'sm:col-span-2' };

export default function MeuCadastroPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-filiado', 'cadastro'],
    queryFn: buscarMeuCadastro,
  });

  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    const inicial: Record<string, string> = {};
    for (const c of CAMPOS) inicial[c.chave] = ((data as never)[c.chave] as string) ?? '';
    setForm(inicial);
  }, [data]);

  /*
    A LISTA DE EDITÁVEIS VEM DO SERVIDOR. Sem isso, a tela teria a própria
    cópia da regra e as duas divergiriam na primeira mudança — como campo que a
    pessoa preenche e o servidor ignora em silêncio.
  */
  const editavel = useMemo(() => new Set(data?.editaveis ?? []), [data]);

  const mudou = useMemo(() => {
    if (!data) return [];
    return CAMPOS.filter((c) => (form[c.chave] ?? '') !== (((data as never)[c.chave] as string) ?? ''))
      .map((c) => c.chave);
  }, [form, data]);

  const salvar = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = {};
      for (const chave of mudou) payload[chave] = form[chave] ?? '';
      return salvarMeuCadastro(payload);
    },
    onSuccess: (novo) => {
      toast.success(
        novo.alterados.length === 1
          ? 'Dado atualizado.'
          : `${novo.alterados.length} dados atualizados.`,
      );
      qc.setQueryData(['portal-filiado', 'cadastro'], novo);
      qc.invalidateQueries({ queryKey: ['portal-filiado', 'resumo'] });
    },
    onError: (e) => toast.error((e as ErroPortal).message || 'Não foi possível salvar.'),
  });

  return (
    <CascaDoPortal>
      <h1 className="mb-1 text-lg font-bold">Meu cadastro</h1>
      <p className="mb-4 text-xs leading-snug text-muted-foreground">
        O que você corrigir aqui vale na hora — ninguém precisa aprovar.
      </p>

      {isLoading || !data ? (
        <Carregando texto="Carregando…">
          <EsqueletoLinhas quantidade={3} altura={100} className="divide-y-0 space-y-3" />
        </Carregando>
      ) : (
        <div className="space-y-4">
          <SoLeitura cadastro={data} />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mudou.length) salvar.mutate();
            }}
            className="rounded-2xl border bg-card p-5"
          >
            <h2 className="text-sm font-bold">Endereço e contato</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              É por aqui que o {tenant.sigla} fala com você.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
              {CAMPOS.filter((c) => editavel.has(c.chave)).map((c) => (
                <div key={c.chave} className={`col-span-2 ${LARGURA[c.largura ?? 'meia']}`}>
                  <label htmlFor={c.chave} className="text-[11px] font-medium text-muted-foreground">
                    {c.rotulo}
                  </label>
                  <Input
                    id={c.chave}
                    type={c.tipo ?? 'text'}
                    inputMode={c.modo}
                    value={form[c.chave] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [c.chave]: e.target.value }))}
                    className="mt-1"
                  />
                  {c.dica && <p className="mt-1 text-[10px] text-muted-foreground">{c.dica}</p>}
                </div>
              ))}
            </div>

            {/*
              O BOTÃO SÓ ACENDE QUANDO HÁ O QUE SALVAR, e diz QUANTOS campos
              mudaram. Um "Salvar" sempre ativo faz a pessoa clicar sem saber se
              mexeu em alguma coisa — e a tela responde "nada para atualizar",
              que parece erro.
            */}
            <Button
              type="submit"
              disabled={!mudou.length || salvar.isPending}
              className="mt-5 w-full sm:w-auto"
            >
              {salvar.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {mudou.length
                    ? `Salvar ${mudou.length} ${mudou.length === 1 ? 'alteração' : 'alterações'}`
                    : 'Nada para salvar'}
                </>
              )}
            </Button>
          </form>
        </div>
      )}
    </CascaDoPortal>
  );
}

/**
 * O QUE SÓ A SECRETARIA MUDA — e por quê, dito na tela.
 *
 * Um bloco cinza com cadeado e nenhuma explicação faz a pessoa ligar
 * perguntando por que não pode corrigir o próprio nome. A frase abaixo responde
 * antes da ligação.
 */
function SoLeitura({ cadastro }: { cadastro: MeuCadastro }) {
  const linhas: Array<[string, string | null]> = [
    ['Nome', cadastro.nomeCompleto],
    ['Matrícula', cadastro.matricula],
    ['CPF', cadastro.cpf ? mascararCpfLgpd(cadastro.cpf) : null],
    ['RG', cadastro.rg ? `${cadastro.rg}${cadastro.ufRg ? ` - ${cadastro.ufRg}` : ''}` : null],
    ['Nascimento', cadastro.dataNascimento ? formatDataPura(cadastro.dataNascimento) : null],
    ['Filiado(a) desde', cadastro.dataFiliacao ? formatDataPura(cadastro.dataFiliacao) : null],
    ['COREN', cadastro.numeroCoren],
  ].filter(([, v]) => !!v) as Array<[string, string]>;

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" /> Dados de identificação
      </h2>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        Estes só a secretaria altera — eles identificam você no sindicato e na Justiça. Se algum
        estiver errado, fale com o {tenant.sigla}.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-xs sm:grid-cols-3">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
            <dd className="mt-0.5 truncate font-medium">{valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
