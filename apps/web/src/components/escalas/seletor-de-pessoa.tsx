'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AdvogadoEscala, nomeDeExibicao, separarParaSeletor } from '@/lib/escalas';

/**
 * Quem pode ser escalado: "Advogados" primeiro, os demais em "Outros da equipe".
 *
 * A lista da API é todo usuário ativo. Na produção só advogado foi escalado,
 * mas um sindicato pode escalar estagiária ou secretária — então agrupa, não
 * esconde. Sem perfil em ninguém (API antiga), vai sem grupos.
 */
export function SeletorDePessoa({
  id,
  value,
  onChange,
  pessoas,
  placeholder,
  excluirId,
  carregando = false,
  disabled,
  className,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  pessoas: AdvogadoEscala[];
  placeholder: string;
  /** Quem já está no plantão, na troca: não faz sentido "trocar consigo". */
  excluirId?: string;
  carregando?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const { advogados, outros, temPerfil } = useMemo(
    () => separarParaSeletor(excluirId ? pessoas.filter((p) => p.id !== excluirId) : pessoas),
    [pessoas, excluirId],
  );
  const opcao = (p: AdvogadoEscala) => (
    <option key={p.id} value={p.id}>{nomeDeExibicao(p)}</option>
  );

  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className={cn(
        'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm',
        className,
      )}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{carregando ? 'Carregando a equipe…' : placeholder}</option>
      {temPerfil ? (
        <>
          {advogados.length > 0 && <optgroup label="Advogados">{advogados.map(opcao)}</optgroup>}
          {outros.length > 0 && <optgroup label="Outros da equipe">{outros.map(opcao)}</optgroup>}
        </>
      ) : (
        advogados.map(opcao)
      )}
    </select>
  );
}
