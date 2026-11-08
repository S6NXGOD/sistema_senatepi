/**
 * NENHUM PROCESSO ENTRA SEM OS DOIS POLOS — pedido do dono em 07/11/2026.
 *
 * *"Quero que ao advogado cadastrar um novo processo no sistema seja obrigatório
 * ele botar logo o polo ativo e passivo. Para que não entre ações sem seus
 * devidos polos."*
 *
 * Medido na produção no mesmo dia: dos 212 processos, **28 estavam sem polo
 * passivo** e 1 sem ativo. O DataJud não devolve partes, então o que não é
 * informado no cadastro fica faltando até alguém lembrar — e "contra quem" é a
 * pergunta que o painel, o dossiê e os relatórios de réu fazem a todo processo.
 *
 * A REGRA MORA AQUI, e não só na tela: a tela pode ser contornada (a chamada
 * direta à API, uma versão antiga do navegador na janela de troca do deploy), e
 * o cadastro em lote da fila do Diário passa pelo mesmo `importar`. Uma regra de
 * integridade que só a tela cobra é sugestão.
 */

/** O mínimo que o cadastro precisa enxergar de cada polo. */
export interface PolosDoCadastro {
  filiadoId?: string | null;
  poloAtivo?: {
    tipo?: string;
    filiadoIds?: string[] | null;
    nome?: string | null;
    partes?: { filiadoId?: string | null; parteExternaId?: string | null; nome?: string | null }[] | null;
  } | null;
  parteContraria?: { parteExternaId?: string | null; nome?: string | null } | null;
  partesContrarias?: { parteExternaId?: string | null; nome?: string | null }[] | null;
}

export type PoloQueFalta = 'ATIVO' | 'PASSIVO' | 'OS_DOIS';

const preenchida = (p?: { filiadoId?: string | null; parteExternaId?: string | null; nome?: string | null } | null) =>
  !!p && (!!p.filiadoId || !!p.parteExternaId || !!p.nome?.trim());

/** Tem quem move a ação? Qualquer uma das formas que a rota aceita conta. */
export function temPoloAtivo(dto: PolosDoCadastro): boolean {
  const a = dto.poloAtivo;
  if (a) {
    if ((a.partes ?? []).some(preenchida)) return true;
    if (a.tipo === 'INSTITUCIONAL') return true;
    if (a.tipo === 'FILIADOS' && (a.filiadoIds ?? []).length > 0) return true;
    if (a.tipo === 'OUTRA' && !!a.nome?.trim()) return true;
  }
  return !!dto.filiadoId;
}

/** Tem contra quem? O réu único antigo e a lista nova contam igual. */
export function temPoloPassivo(dto: PolosDoCadastro): boolean {
  return preenchida(dto.parteContraria) || (dto.partesContrarias ?? []).some(preenchida);
}

export function poloQueFalta(dto: PolosDoCadastro): PoloQueFalta | null {
  const ativo = temPoloAtivo(dto);
  const passivo = temPoloPassivo(dto);
  if (ativo && passivo) return null;
  if (!ativo && !passivo) return 'OS_DOIS';
  return ativo ? 'PASSIVO' : 'ATIVO';
}

/** A frase da recusa — curta, porque também aparece agrupada no cadastro em lote. */
export const FRASE_DO_POLO_QUE_FALTA: Record<PoloQueFalta, string> = {
  ATIVO: 'Informe o polo ativo (quem move a ação) para cadastrar o processo.',
  PASSIVO: 'Informe o polo passivo (contra quem é a ação) para cadastrar o processo.',
  OS_DOIS: 'Informe os dois polos (quem move a ação e contra quem) para cadastrar o processo.',
};

/** Na formalização do pré-processual, as partes já estão gravadas: conta-se o que existe. */
export function poloQueFaltaNasPartes(polos: string[]): PoloQueFalta | null {
  const ativo = polos.includes('ATIVO');
  const passivo = polos.includes('PASSIVO');
  if (ativo && passivo) return null;
  if (!ativo && !passivo) return 'OS_DOIS';
  return ativo ? 'PASSIVO' : 'ATIVO';
}
