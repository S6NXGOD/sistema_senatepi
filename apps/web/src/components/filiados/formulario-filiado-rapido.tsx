'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { V } from '@/lib/vocabulario';

/**
 * CADASTRO MÍNIMO DE FILIADO, no meio de outra tarefa.
 *
 * Existe porque a alternativa real não era "cadastrar direito depois": era
 * lançar a pessoa como texto livre no processo e seguir em frente. O processo
 * ficava sem dono, a ficha da pessoa sem o processo, e ninguém tinha como
 * saber que eram a mesma. Um formulário de quatro campos aqui evita isso.
 *
 * SÃO OS OBRIGATÓRIOS DA API, e nada além — nome, CPF e nascimento. Pedir
 * endereço, matrícula e vínculo funcional no meio do cadastro de um processo
 * garante que o campo seja preenchido com qualquer coisa. O resto se completa
 * na ficha, que é onde a secretaria trabalha.
 *
 * O CPF NÃO É OPCIONAL de propósito: é ele que identifica a pessoa quando o
 * nome dos autos não bate com o do cadastro, e é o único dado que permite
 * vincular processo e filiado sem alguém conferir no olho.
 */

const soDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 11);

export function mascaraCpf(v: string): string {
  const d = soDigitos(v);
  let out = d.slice(0, 3);
  if (d.length > 3) out += '.' + d.slice(3, 6);
  if (d.length > 6) out += '.' + d.slice(6, 9);
  if (d.length > 9) out += '-' + d.slice(9, 11);
  return out;
}

export interface FiliadoCriado {
  id: string;
  nome: string;
  cpfMascarado: string | null;
}

export function FormularioFiliadoRapido({
  nomeInicial,
  onCriado,
  onCancelar,
  rotuloAcao = 'Cadastrar e vincular',
}: {
  nomeInicial?: string | null;
  onCriado: (f: FiliadoCriado) => void | Promise<void>;
  onCancelar?: () => void;
  rotuloAcao?: string;
}) {
  const [nome, setNome] = useState(nomeInicial ?? '');
  const [cpf, setCpf] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => setNome(nomeInicial ?? ''), [nomeInicial]);

  const criar = useMutation({
    mutationFn: async (): Promise<FiliadoCriado> => {
      const { data } = await api.post('/filiados', {
        nomeCompleto: nome.trim(),
        cpf: soDigitos(cpf),
        dataNascimento: nascimento,
        ...(telefone.trim() ? { telefonePrincipal: telefone.trim() } : {}),
      });
      return { id: data.id, nome: data.nomeCompleto ?? nome.trim(), cpfMascarado: mascaraCpf(cpf) };
    },
    onMutate: () => setErro(null),
    onSuccess: (f) => onCriado(f),
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      setErro(Array.isArray(m) ? m[0] : (m ?? `Não foi possível cadastrar o ${V.filiado}.`));
    },
  });

  const pronto = nome.trim().length >= 3 && soDigitos(cpf).length === 11 && !!nascimento;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Nome completo *</label>
        <Input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Maria Souza Lima"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">CPF *</label>
          <Input
            value={cpf}
            onChange={(e) => setCpf(mascaraCpf(e.target.value))}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Nascimento *</label>
          <Input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Telefone</label>
        <Input
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          placeholder="(86) 90000-0000"
        />
      </div>

      {/*
        O ERRO FICA NO FORMULÁRIO, e não num toast que some em quatro segundos.
        A mensagem que mais aparece aqui é "já existe filiado com este CPF" — e
        ela é a resposta útil: a pessoa já está cadastrada, é só procurar.
      */}
      {erro && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {erro}
        </p>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground">
        Cadastro mínimo. Os demais dados podem ser completados depois na ficha do {V.filiado}.
      </p>

      <div className="flex justify-end gap-2">
        {onCancelar && (
          <Button type="button" variant="outline" onClick={onCancelar} disabled={criar.isPending}>
            Cancelar
          </Button>
        )}
        <Button type="button" onClick={() => criar.mutate()} disabled={!pronto || criar.isPending}>
          {criar.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {rotuloAcao}
        </Button>
      </div>
    </div>
  );
}
