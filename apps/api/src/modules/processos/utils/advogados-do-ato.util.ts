/**
 * OS ADVOGADOS QUE O DIÁRIO NOMEIA — e o que dá para provar sobre cada um.
 *
 * O QUE O CNJ MANDA (conferido na origem em 11/09/2026, publicação real):
 *
 *   destinatarios:          [{ nome: "HOME COMFORT ...", polo: "A" },
 *                            { nome: "SINDICATO ... SENATEPI", polo: "P" }]
 *   destinatarioadvogados:  [{ advogado: { nome, numero_oab, uf_oab } }, ...]
 *
 * Repare no que NÃO existe: nada liga um advogado a uma parte. O ato traz o
 * polo das PARTES e uma lista única de advogados — nossos e os da outra parte
 * misturados, sem lado. Numa publicação do acervo vieram nove advogados: três
 * nossos e seis de fora, todos no mesmo array, sem uma pista sequer de quem
 * representa quem.
 *
 * Daí a regra deste arquivo, que é a mesma do resto do sistema: **liga o que dá
 * para provar, oferece o que dá para inferir, e nunca inventa o resto.**
 *
 *  - PROVADO: a OAB bate com a de um advogado nosso, ativo → é da nossa equipe.
 *    Número e UF, jamais o nome: o tribunal escreve "ICARO SOL ALMONDES SANTOS"
 *    e o cadastro tem "Ícaro Sol Almondes Santos".
 *  - INFERIDO: quem não é nosso atua no processo — e, quando existe UMA única
 *    parte no polo contrário, é dela que ele é advogado. Medido: 154 dos 168
 *    processos têm exatamente uma parte em cada polo.
 *  - NÃO SE INVENTA: com duas ou mais partes do outro lado, o advogado fica sem
 *    dono. Melhor uma lista honesta que um nome no réu errado.
 */

/** Chave de casamento da OAB: "PI-9226". Número e UF, nunca o nome. */
export function chaveOab(numero: unknown, uf: unknown): string {
  return `${String(uf ?? '').trim().toUpperCase()}-${String(numero ?? '').replace(/\D/g, '')}`;
}

/** Chave utilizável? "PI-" (sem número) casaria com qualquer um. */
export function oabUtilizavel(numero: unknown, uf: unknown): boolean {
  const chave = chaveOab(numero, uf);
  const [estado, digitos] = chave.split('-');
  return estado.length === 2 && digitos.length >= 3;
}

/** Um advogado como o DJEN o entrega. */
export interface AdvogadoCitado {
  nome: string | null;
  numeroOab: string | null;
  ufOab: string | null;
}

/**
 * Um advogado da outra parte, como fica gravado em `partes_processo.advogados`.
 *
 * `oab` é o texto que a tela mostra ("PI 11632") e existia antes desta
 * funcionalidade — quem digitava à mão escrevia nele. `numeroOab`/`ufOab` são a
 * mesma coisa em pedaços, e servem para casar: é por eles que o robô sabe que
 * já gravou este advogado, e que ele não é um dos nossos.
 *
 * `origem` separa o que o robô deduziu do que uma pessoa escreveu — é ela que
 * impede a varredura de amanhã de desfazer a correção de hoje.
 */
export interface AdvogadoDaParte {
  nome: string;
  /** Como se lê: "PI 11632". */
  oab?: string | null;
  numeroOab: string | null;
  ufOab: string | null;
  /** 'DJEN' = veio do Diário; 'MANUAL' = alguém digitou. */
  origem?: string;
  /** Quando o Diário nomeou este advogado pela última vez (ISO). */
  vistoEm?: string;
}

/** "PI 11632" a partir dos pedaços; vazio vira nulo. */
export function oabPorExtenso(numero: unknown, uf: unknown): string | null {
  const n = String(numero ?? '').replace(/\D/g, '');
  const u = String(uf ?? '').trim().toUpperCase();
  if (!n) return u || null;
  return u ? `${u} ${n}` : n;
}

/**
 * O CAMINHO INVERSO: lê o que alguém digitou e tenta achar número e UF.
 *
 * A tela sempre teve um campo de texto livre ("OAB"), e gente escreve de todo
 * jeito: "PI 11632", "11632/PI", "OAB/PI 11.632". Sem interpretar, um advogado
 * digitado à mão seria gravado de novo pelo robô, em duplicata.
 */
export function lerOabDigitada(texto: unknown): { numeroOab: string | null; ufOab: string | null } {
  const bruto = String(texto ?? '').toUpperCase();
  const numeroOab = (bruto.replace(/\D/g, '') || null) && bruto.replace(/\D/g, '');
  const uf = /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/.exec(
    bruto.replace(/OAB/g, ' '),
  );
  return { numeroOab: numeroOab || null, ufOab: uf ? uf[1] : null };
}

export interface AdvogadosSeparados {
  /** Ids dos NOSSOS advogados (usuários ativos) que o ato nomeia. */
  nossos: string[];
  /** Os demais, sem lado definido — candidatos a advogado da outra parte. */
  outros: AdvogadoCitado[];
}

/**
 * Separa a lista do ato entre "nossos" e "os outros", sem repetir ninguém.
 *
 * Sem OAB utilizável ninguém entra: um advogado sem número não pode ser casado
 * com o cadastro nem identificado depois, e entraria de novo a cada varredura.
 */
export function separarAdvogadosDoAto(
  citados: unknown,
  nossosPorOab: Map<string, string>,
): AdvogadosSeparados {
  const lista = Array.isArray(citados) ? (citados as AdvogadoCitado[]) : [];
  const nossos = new Set<string>();
  const outros = new Map<string, AdvogadoCitado>();

  for (const a of lista) {
    if (!oabUtilizavel(a?.numeroOab, a?.ufOab)) continue;
    const chave = chaveOab(a?.numeroOab, a?.ufOab);
    const nosso = nossosPorOab.get(chave);
    if (nosso) {
      nossos.add(nosso);
      continue;
    }
    const nome = (a?.nome ?? '').trim();
    if (!nome) continue;
    // O mesmo advogado aparece em dezenas de publicações do mesmo processo.
    if (!outros.has(chave)) {
      outros.set(chave, {
        nome,
        numeroOab: String(a?.numeroOab ?? '').replace(/\D/g, '') || null,
        ufOab: (a?.ufOab ?? '').toUpperCase() || null,
      });
    }
  }

  return { nossos: [...nossos], outros: [...outros.values()] };
}

/**
 * JUNTA o que o Diário trouxe com o que já está gravado na parte.
 *
 * TRÊS REGRAS, e a ordem delas é o contrato:
 *
 *  1. O QUE UMA PESSOA ESCREVEU FICA. Nunca se apaga nem se reescreve entrada
 *     com origem manual — nem o nome, que o cartório pode ter grafado melhor.
 *  2. QUEM JÁ ESTÁ, NÃO ENTRA DE NOVO. A chave é a OAB; sem ela, o nome.
 *  3. NADA SOME. O advogado que saiu do processo continua listado, com a data
 *     em que o Diário o viu pela última vez — é histórico do caso, e apagar
 *     seria perder a informação de quem atuou até ontem.
 *
 * Devolve `null` quando não há nada a mudar: assim o serviço não grava por
 * gravar, e a auditoria não enche de "atualizou a parte" sem alteração.
 */
export function mesclarAdvogadosDaParte(
  atuais: unknown,
  novos: AdvogadoCitado[],
  agoraIso: string,
): AdvogadoDaParte[] | null {
  const lista: AdvogadoDaParte[] = Array.isArray(atuais) ? [...(atuais as AdvogadoDaParte[])] : [];
  const indice = new Map<string, number>();
  lista.forEach((a, i) => {
    /*
      A entrada antiga (ou digitada) pode ter só o texto "PI 11632" no campo
      `oab`. Ler esse texto é o que impede o robô de gravar em duplicata alguém
      que uma pessoa já tinha anotado.
    */
    const digitada = lerOabDigitada(a?.oab);
    const numero = a?.numeroOab ?? digitada.numeroOab;
    const uf = a?.ufOab ?? digitada.ufOab;
    const chave = oabUtilizavel(numero, uf)
      ? chaveOab(numero, uf)
      : `nome:${(a?.nome ?? '').trim().toLowerCase()}`;
    if (!indice.has(chave)) indice.set(chave, i);
  });

  let mudou = false;
  for (const novo of novos) {
    const chave = chaveOab(novo.numeroOab, novo.ufOab);
    const jaEsta = indice.get(chave);
    if (jaEsta !== undefined) {
      const atual = lista[jaEsta];
      // Só o carimbo de "visto agora", e só no que o robô trouxe: mexer numa
      // entrada manual é justamente o que a regra 1 proíbe.
      if ((atual.origem ?? 'MANUAL') === 'DJEN' && atual.vistoEm !== agoraIso) {
        lista[jaEsta] = { ...atual, vistoEm: agoraIso };
        mudou = true;
      }
      continue;
    }
    lista.push({
      nome: novo.nome ?? '',
      oab: oabPorExtenso(novo.numeroOab, novo.ufOab),
      numeroOab: novo.numeroOab,
      ufOab: novo.ufOab,
      origem: 'DJEN',
      vistoEm: agoraIso,
    });
    indice.set(chave, lista.length - 1);
    mudou = true;
  }

  return mudou ? lista : null;
}
