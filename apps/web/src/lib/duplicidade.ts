import { api } from './api';
// A base grava CPF com e sem pontuação; o veredito é lido por gente.
import { mascararCpf } from './utils';

/**
 * Mutirão de consolidação de cadastros duplicados.
 *
 * Ferramenta TEMPORÁRIA: existe para higienizar a carga legada, em que 70% dos
 * filiados vieram sem CPF e o índice único não teve como impedir repetição.
 * Some sozinha quando não houver mais grupos pendentes, e pode ser desligada
 * pela variável FILIADOS_DUPLICIDADE na API.
 */

export type Confianca = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface CandidatoDuplicata {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  numeroCoren: string | null;
  cidade: string | null;
  estado: string | null;
  telefonePrincipal: string | null;
  email: string | null;
  dataNascimento: string | null;
  endereco: string | null;
  situacao: string;
  dataFiliacao: string | null;
  createdAt: string;
  temFoto: boolean;
  vinculos: number;
  pontuacao: number;
  sugerido: boolean;
}

export interface GrupoDuplicata {
  chave: string;
  confianca: Confianca;
  criterio: string;
  motivoSugestao: string | null;
  /** Falso = o sistema NÃO sabe escolher; a decisão é inteiramente humana. */
  decidiu: boolean;
  contradicoes: string[];
  /**
   * Quando o CPF é um dos campos que divergem: o que o dígito verificador diz.
   * Nulo sem conflito. Opcional pela janela de troca do deploy.
   */
  cpfEmConflito?: AnaliseDeCpf | null;
  /** Ninguém no grupo tem dado que identifique pessoa — ver `separarDecidiveis`. */
  esperandoDado?: boolean;
  candidatos: CandidatoDuplicata[];
}

/**
 * TIRA DA FILA O QUE NINGUÉM TEM COMO DECIDIR (18/09/2026).
 *
 * São grupos em que NENHUM cadastro tem CPF, COREN, nascimento, contato,
 * endereço, foto ou vínculo: nomes iguais e mais nada. Ninguém — nem o sistema,
 * nem a Coordenação — consegue dizer se são a mesma pessoa. Deixá-los na fila
 * de decisões é pedir um julgamento impossível. Na produção de 18/09/2026, 251
 * dos 274 grupos que sobram do lote são assim: a fila parecia 274 decisões
 * atrasadas quando 23 pediam alguém.
 *
 * Eles NÃO somem: ficam a um clique, e voltam sozinhos quando o cadastro ganhar
 * um dado — num recadastramento, num atendimento, numa ficha de processo.
 *
 * A API antiga não manda o campo. Sem ele, `esperandoDado` é indefinido e tudo
 * continua na fila, como antes: a tela não inventa um balde durante a janela de
 * troca do deploy.
 */
export function separarDecidiveis(grupos: GrupoDuplicata[]): {
  decidiveis: GrupoDuplicata[];
  esperando: GrupoDuplicata[];
} {
  return {
    decidiveis: grupos.filter((g) => !g.esperandoDado),
    esperando: grupos.filter((g) => g.esperandoDado === true),
  };
}

/**
 * O QUE A TELA DIZ QUANDO NÃO HÁ NADA PARA DECIDIR — 22/09/2026.
 *
 * O DONO ABRIU A FILA E VIU UM BECO: "Confiança Alta 0 · Média 0 · Baixa 0",
 * um ✓ verde dizendo "Nada pendente nesta confiança", e — em cinza de 11px, no
 * rodapé — "Outros 148 grupos esperam um dado (...) Ver assim mesmo". A
 * resposta dele foi exatamente a certa: **"aqui não aparece nada pra fazer"**.
 *
 * O ✓ verde estava MENTINDO. Ele quer dizer "acabou", e não acabou: há 148
 * grupos de nome igual do outro lado de um link que ninguém vê.
 *
 * A ESCOLHA DE 18/09 NÃO ESTAVA ERRADA — ficou velha. Naquele dia o balde foi
 * escondido para a fileira de abas não exibir "397 pendências" que ninguém
 * decide, e havia trabalho real nas outras confianças. Com as três em ZERO, o
 * único balde com conteúdo é o escondido, e escondê-lo é esconder a tela
 * inteira.
 *
 * Três estados, e cada um diz uma coisa diferente:
 *
 *  · `TUDO_RESOLVIDO` — não há nem decidível nem esperando. Aí sim, ✓ verde.
 *  · `SO_ESPERANDO`   — nada a decidir AQUI, mas há grupos sem dado. O ✓ sai de
 *                       cena e a tela oferece a porta como AÇÃO, não rodapé.
 *  · `TEM_EM_OUTRA`   — esta confiança está vazia e outra tem fila. Mandar para
 *                       lá é mais útil que anunciar vazio.
 */
export type EstadoDaFila = 'TUDO_RESOLVIDO' | 'SO_ESPERANDO' | 'TEM_EM_OUTRA';

export function estadoDaFila(entrada: {
  /** Grupos na aba aberta agora. */
  nestaAba: number;
  /** Decidíveis em QUALQUER confiança. */
  decidiveis: number;
  /** Grupos sem nenhum dado que os distinga. */
  esperando: number;
}): EstadoDaFila | null {
  if (entrada.nestaAba > 0) return null;
  if (entrada.decidiveis > 0) return 'TEM_EM_OUTRA';
  return entrada.esperando > 0 ? 'SO_ESPERANDO' : 'TUDO_RESOLVIDO';
}

/**
 * O QUE DISTINGUE DUAS FICHAS QUANDO NÃO HÁ DADO NENHUM.
 *
 * Nos grupos que esperam dado, os cartões mostram nome, matrícula e "Nenhum
 * outro dado cadastrado" — e a pessoa precisa decidir alguma coisa com isso.
 * Sobram três fatos, e eles não estavam todos na tela:
 *
 *   · a MATRÍCULA (sempre existe, é única nas 5.832 fichas);
 *   · QUANDO a pessoa se filiou (113 dos 145 grupos têm datas diferentes);
 *   · QUANDO a ficha foi criada — que é o que separa "duas fichas do mesmo dia,
 *     matrículas consecutivas" de "uma de 2014 e outra da carga de 2026".
 *
 * Nenhum dos três PROVA nada, e a frase que acompanha diz isso. Mas decidir com
 * três fatos é decidir; decidir com zero é sortear.
 */
export const CAMPOS_DE_ULTIMO_RECURSO: ReadonlyArray<{ chave: string; rotulo: string }> = [
  // `dataFiliacao` já está em `CAMPOS_COMPARADOS` e sai sozinha; aqui entra só
  // o que não estava em lugar nenhum.
  { chave: 'createdAt', rotulo: 'Ficha criada em' },
];

export const CONFIANCA_LABEL: Record<Confianca, string> = {
  ALTA: 'Alta',
  MEDIA: 'Média',
  BAIXA: 'Baixa',
};

export const CONFIANCA_COR: Record<Confianca, string> = {
  ALTA: 'bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-100',
  MEDIA: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  BAIXA: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200',
};

/** O que cada nível de confiança significa, em uma frase. */
export const CONFIANCA_EXPLICACAO: Record<Confianca, string> = {
  ALTA: 'Mesmo nome e mesma cidade, sem nenhum campo se contradizendo.',
  MEDIA: 'Mesmo nome e nada se contradiz, mas falta a cidade para confirmar.',
  BAIXA: 'Há campo divergente ou o nome só é parecido — confira antes de decidir.',
};

export async function statusDuplicidade(): Promise<{
  ativo: boolean;
  /** Grupos que ALGUÉM consegue decidir — é o que o aviso âmbar promete. */
  pendentes: number;
  /** Grupos sem dado nenhum: existem, mas não pedem ninguém. */
  esperandoDado?: number;
}> {
  try {
    return (await api.get('/filiados/duplicidade/status')).data;
  } catch {
    // Perfil sem acesso, recurso desligado ou API antiga: a ferramenta
    // simplesmente não aparece. Não é erro que mereça alarme na tela.
    return { ativo: false, pendentes: 0 };
  }
}

export async function listarDuplicados(): Promise<GrupoDuplicata[]> {
  return (await api.get('/filiados/duplicidade')).data;
}

/** Devolve o `id` da marcação (API desde 15/09/2026): é o que o "Desfazer" do aviso usa. */
export async function marcarDistintos(idA: string, idB: string): Promise<{ ok: boolean; id?: string }> {
  return (await api.post('/filiados/duplicidade/distintos', { idA, idB })).data;
}

export interface CadastroDescartado {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cidade: string | null;
  cpf: string | null;
  dataNascimento: string | null;
}

/** Par marcado como pessoas diferentes — saiu da fila, mas tem volta. */
export interface ParDescartado {
  id: string;
  autor: string | null;
  decididoEm: string;
  cadastros: CadastroDescartado[];
}

export async function listarDescartados(): Promise<ParDescartado[]> {
  return (await api.get('/filiados/duplicidade/descartados')).data;
}

export async function voltarParaFila(decisaoId: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/filiados/duplicidade/distintos/${decisaoId}`)).data;
}

const DIA_DE_TERESINA: Intl.DateTimeFormatOptions = {
  timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric',
};

/** Um campo "tem valor"? Vazio, nulo e string em branco contam como nada. */
export function temValor(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/**
 * QUANTOS DADOS ESTE CADASTRO CARREGA — a régua de "qual é o mais rico".
 *
 * POR QUE ELA EXISTE. Medido no acervo em 18/09/2026: dos 7.033 filiados,
 * **3.259 (46%) não têm NENHUM** dos sete campos comparados, e 2.208 têm um só.
 * A tela desenhava as oito linhas sempre, então o olho varria 20.920 células em
 * 1.174 grupos para encontrar 6.557 com conteúdo — **69% de traço**. Comparar
 * dois cadastros virava ler dezesseis linhas para achar duas.
 *
 * Com o número na frente, a comparação vira "3 dados contra 1" antes de ler
 * campo nenhum — e nos 143 grupos em que ninguém tem nada, o número diz isso de
 * uma vez: não há o que comparar, escolha qualquer um.
 *
 * `dataFiliacao` fica FORA da conta de propósito: toda linha tem uma, então ela
 * não separa ninguém. Ela continua aparecendo no cartão porque ajuda a lembrar
 * qual é o cadastro antigo.
 */
export const CAMPOS_DE_RIQUEZA = [
  'cpf', 'numeroCoren', 'dataNascimento', 'cidade', 'telefonePrincipal', 'email', 'endereco',
] as const;

export function quantosDados(c: Partial<Record<string, unknown>>): number {
  return CAMPOS_DE_RIQUEZA.filter((k) => temValor(c[k])).length;
}

/** "3 dados", "1 dado", "sem dados" — do jeito que uma pessoa diria. */
export function frasesDaRiqueza(n: number): string {
  if (n === 0) return 'sem dados';
  return n === 1 ? '1 dado' : `${n} dados`;
}

/** "Teresina · com CPF · nasc. 10/11/1970" — o que ajuda a rever se é a mesma pessoa. */
export function resumoDoCadastro(c: Pick<CadastroDescartado, 'cidade' | 'cpf' | 'dataNascimento'>): string {
  return [
    c.cidade?.trim() || null,
    c.cpf ? 'com CPF' : 'sem CPF',
    c.dataNascimento ? `nasc. ${new Date(c.dataNascimento).toLocaleDateString('pt-BR', DIA_DE_TERESINA)}` : null,
  ].filter(Boolean).join(' · ');
}

/** "Marcado por Julian Helton em 02/09/2026". Sem autor gravado, não inventa um. */
export function fraseDoDescarte(p: Pick<ParDescartado, 'autor' | 'decididoEm'>): string {
  const dia = new Date(p.decididoEm).toLocaleDateString('pt-BR', DIA_DE_TERESINA);
  return p.autor ? `Marcado por ${p.autor} em ${dia}` : `Marcado em ${dia}`;
}

/**
 * `cpfQueFica` só vai quando os dois CPFs divergem e alguém escolheu — ver
 * `AnaliseDeCpf`. Sem ele o servidor recusa a fusão, como sempre fez.
 */
export async function fundirDuplicados(
  manterId: string,
  descartarId: string,
  cpfQueFica?: string,
) {
  return (
    await api.delete('/filiados/duplicidade/fundir', {
      data: { manterId, descartarId, ...(cpfQueFica ? { cpfQueFica } : {}) },
    })
  ).data;
}

export interface ResultadoDaConsolidacao {
  ok?: boolean;
  fundidos?: number;
  camposAbsorvidos?: string[];
  vinculosTransferidos?: number;
  falhas?: { matricula: string; motivo: string }[];
}

/** Grupo de três ou mais: o servidor confere os CPFs antes de apagar qualquer coisa. */
export async function fundirGrupoDuplicados(
  manterId: string,
  descartarIds: string[],
): Promise<ResultadoDaConsolidacao> {
  return (await api.delete('/filiados/duplicidade/fundir-grupo', { data: { manterId, descartarIds } })).data;
}

/** Marca TODOS os pares do grupo — senão o grupo volta na varredura seguinte. */
export async function marcarGrupoDistinto(ids: string[]): Promise<{ ok: boolean; ids: string[] }> {
  return (await api.post('/filiados/duplicidade/distintos-grupo', { ids })).data;
}

/** Tira UM do grupo: distinto de cada um dos outros, sem julgar os que ficam. */
export async function marcarForaDoGrupo(id: string, outros: string[]): Promise<{ ok: boolean; ids: string[] }> {
  return (await api.post('/filiados/duplicidade/fora-do-grupo', { id, outros })).data;
}

export interface DescarteAgrupado {
  chave: string;
  autor: string | null;
  decididoEm: string;
  cadastros: CadastroDescartado[];
  /** As decisões (pares) que essa linha representa — o desfazer devolve todas. */
  ids: string[];
}

/**
 * JUNTA O QUE FOI DECIDIDO DE UMA VEZ (17/09/2026).
 *
 * A decisão é gravada por PAR: marcar um grupo de três grava três pares, e tirar
 * um cadastro de um grupo de cinco grava quatro. A lista mostrava uma linha para
 * cada par, repetindo os mesmos nomes. Aqui os pares que se tocam viram uma
 * linha só — e "Voltar para a fila" desfaz o conjunto, não um pedaço dele.
 */
export function agruparDescartes(pares: ParDescartado[]): DescarteAgrupado[] {
  const pai = new Map<string, string>();
  const raiz = (x: string): string => {
    const p = pai.get(x);
    if (!p || p === x) { pai.set(x, x); return x; }
    const r = raiz(p);
    pai.set(x, r);
    return r;
  };
  const unir = (a: string, b: string) => {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra !== rb) pai.set(ra, rb);
  };
  for (const p of pares) {
    const [a, b] = p.cadastros;
    if (a && b) unir(a.id, b.id);
  }

  const mapa = new Map<string, DescarteAgrupado>();
  for (const p of pares) {
    const primeiro = p.cadastros[0];
    const chave = primeiro ? raiz(primeiro.id) : p.id;
    const atual = mapa.get(chave);
    if (!atual) {
      mapa.set(chave, { chave, autor: p.autor, decididoEm: p.decididoEm, cadastros: [...p.cadastros], ids: [p.id] });
      continue;
    }
    atual.ids.push(p.id);
    for (const c of p.cadastros) {
      if (!atual.cadastros.some((x) => x.id === c.id)) atual.cadastros.push(c);
    }
    // Fica a decisão mais recente do conjunto — é o que a pessoa lembra de ter feito.
    if (p.decididoEm > atual.decididoEm) { atual.decididoEm = p.decididoEm; atual.autor = p.autor; }
  }
  return [...mapa.values()];
}

/** "Consolidar mantendo 6223" no par; "Consolidar 3 mantendo 008005" no grupo maior. */
export function rotuloDoConsolidar(quantos: number, matricula: string): string {
  return quantos > 2 ? `Consolidar ${quantos} mantendo ${matricula}` : `Consolidar mantendo ${matricula}`;
}

/**
 * O aviso depois de consolidar. O grupo pode dar certo em parte, e nesse caso a
 * pessoa precisa saber QUAL cadastro ficou de fora — "consolidado" seco mentiria.
 */
/**
 * Nome do campo em português. O aviso mostrava `dataFiliacao` e `telefonePrincipal`
 * crus para quem nunca viu o banco — e, depois que a filiação passou a ser
 * preservada, `dataFiliacao` virou o campo mais frequente do aviso.
 */
const NOME_DO_CAMPO: Record<string, string> = {
  cpf: 'CPF', rg: 'RG', ufRg: 'UF do RG', dataNascimento: 'nascimento', sexo: 'sexo',
  estadoCivil: 'estado civil', naturalidade: 'naturalidade', telefonePrincipal: 'telefone',
  telefoneSecundario: 'telefone secundário', email: 'e-mail', cep: 'CEP', endereco: 'endereço',
  numero: 'número', complemento: 'complemento', bairro: 'bairro', cidade: 'cidade',
  estado: 'estado', numeroCoren: 'COREN', dataAdmissao: 'admissão', formacao: 'formação',
  formacaoOutro: 'formação', dataFiliacao: 'data de filiação',
  modalidadeContribuicao: 'contribuição', fotoKey: 'foto', fotoThumbKey: 'foto',
};

export function nomeDoCampo(chave: string): string {
  return NOME_DO_CAMPO[chave] ?? chave;
}
export function avisoDaConsolidacao(r: ResultadoDaConsolidacao): { tom: 'ok' | 'aviso'; texto: string } {
  const aproveitados = r.camposAbsorvidos?.length
    ? ` Aproveitados: ${r.camposAbsorvidos.map(nomeDoCampo).join(', ')}.`
    : '';
  if (r.falhas?.length) {
    return {
      tom: 'aviso',
      texto:
        `${r.fundidos ?? 0} consolidado(s). Ficou de fora: ${r.falhas.map((f) => f.matricula).join(', ')} — ` +
        `${r.falhas[0].motivo}`,
    };
  }
  const quantos = r.fundidos ?? 1;
  return { tom: 'ok', texto: (quantos > 1 ? `${quantos} cadastros consolidados.` : 'Cadastros consolidados.') + aproveitados };
}

export interface ItemLote {
  manterId: string;
  descartarId: string;
  nome: string;
  manterMatricula: string;
  descartarMatricula: string;
}

/**
 * Prévia do lote — os grupos em que o cadastro descartado não tem CPF, COREN,
 * nascimento, contato, endereço, foto nem vínculo. São a maior parte da fila.
 *
 * "Completamente vazio" era o que estava escrito aqui, e não era: nem a data de
 * filiação nem a cidade pontuam para esse fim, e ambas seguem para o cadastro
 * mantido na fusão. `recuamFiliacao` conta aqueles em que a data que vem é a
 * mais antiga da pessoa — o tempo de sindicato que seria perdido.
 */
export async function previaLote(): Promise<{
  total: number;
  recuamFiliacao?: number;
  /** Quantos GRUPOS o lote fecha — um grupo de três gera dois pares. */
  gruposResolvidos?: number;
  /** Dos grupos que SOBRAM, os que ninguém tem como decidir. */
  gruposEsperandoDado?: number;
  amostra: ItemLote[];
}> {
  return (await api.get('/filiados/duplicidade/lote')).data;
}

/**
 * Executa UMA FATIA do lote. Chamar em laço até `restantes` zerar: 704 fusões
 * numa requisição só estourariam o tempo do proxy, e uma queda no meio
 * deixaria o operador sem saber o que foi feito.
 */
export async function executarLote(limite = 25): Promise<{
  fundidos: number;
  restantes: number;
  falhas: { nome: string; motivo: string }[];
}> {
  return (await api.delete('/filiados/duplicidade/lote', { data: { limite } })).data;
}

/** Campos comparados lado a lado no cartão, na ordem em que ajudam a decidir. */
export const CAMPOS_COMPARADOS = [
  { chave: 'cpf', rotulo: 'CPF' },
  { chave: 'numeroCoren', rotulo: 'COREN' },
  { chave: 'dataNascimento', rotulo: 'Nascimento' },
  { chave: 'cidade', rotulo: 'Cidade' },
  { chave: 'telefonePrincipal', rotulo: 'Telefone' },
  { chave: 'email', rotulo: 'E-mail' },
  { chave: 'endereco', rotulo: 'Endereço' },
  { chave: 'dataFiliacao', rotulo: 'Filiação' },
] as const;

/**
 * O QUE A CONSOLIDAÇÃO GANHA E O QUE ELA APAGA.
 *
 * A confirmação mostrava só metade da conta — o que seria COPIADO. Quando os
 * dois cadastros têm o mesmo campo preenchido com valores diferentes, o do
 * removido some junto com o registro, e a tela dizia "não tem nenhum dado que o
 * mantido já não tenha": verdade que engana. Aqui as duas metades saem da MESMA
 * regra, para a prévia não poder discordar do que o servidor faz.
 *
 * `dataFiliacao` fica de fora das duas listas porque tem regra própria: a mais
 * antiga prevalece, sempre, e nunca se adianta. Não é perda nem cópia — é
 * preservação de tempo de sindicato, e a tela precisa dizer isso com outras
 * palavras.
 */
export interface PlanoDaConsolidacao {
  absorvidos: { chave: string; rotulo: string; de: CandidatoDuplicata }[];
  perdidos: { chave: string; rotulo: string; de: CandidatoDuplicata }[];
  /** O cadastro removido cuja filiação é mais antiga — nulo quando não há. */
  filiacaoPreservada: CandidatoDuplicata | null;
}

export function planejarConsolidacao(
  manter: CandidatoDuplicata,
  descartar: CandidatoDuplicata[],
  /**
   * O CPF ESCOLHIDO QUANDO OS DOIS DIVERGEM — só dígitos, ver `veredictoDoCpf`.
   *
   * SEM ISTO A PRÉVIA SE CONTRADIZ (18/09/2026). O bloco do conflito dizia
   * "fica o da matrícula 5811" e, três linhas abaixo, o resumo de sempre dizia
   * "SERÁ APAGADO: CPF 840.053.863-34" — o MESMO número. Dois avisos opostos na
   * mesma tela, no diálogo que apaga cadastro.
   *
   * A prévia tem de calcular o que o servidor calcula: com a escolha em mãos, o
   * CPF perdido é o NÃO escolhido, venha ele de qual lado vier.
   */
  cpfQueFica?: string | null,
): PlanoDaConsolidacao {
  const ler = (c: CandidatoDuplicata, chave: string) => c[chave as keyof CandidatoDuplicata];
  const igual = (a: unknown, b: unknown) =>
    String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

  const absorvidos: PlanoDaConsolidacao['absorvidos'] = [];
  const perdidos: PlanoDaConsolidacao['perdidos'] = [];

  for (const { chave, rotulo } of CAMPOS_COMPARADOS) {
    if (chave === 'dataFiliacao') continue;
    const meu = ler(manter, chave);
    if (!temValor(meu)) {
      // Buraco: o primeiro que tiver valor preenche, como faz o servidor.
      const fonte = descartar.find((d) => temValor(ler(d, chave)));
      if (fonte) absorvidos.push({ chave, rotulo, de: fonte });
      continue;
    }
    for (const d of descartar) {
      const dele = ler(d, chave);
      if (temValor(dele) && !igual(dele, meu)) perdidos.push({ chave, rotulo, de: d });
    }
  }

  /*
    O CPF ESCOLHIDO REESCREVE AS DUAS LISTAS. Quando quem decide diz qual CPF
    fica, ele deixa de seguir o cadastro mantido: o escolhido é absorvido (se
    vier do removido) e o outro é o que se perde.
  */
  if (cpfQueFica) {
    const digitos = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');
    const semCpf = <T extends { chave: string }>(l: T[]) => l.filter((x) => x.chave !== 'cpf');
    absorvidos.splice(0, absorvidos.length, ...semCpf(absorvidos));
    perdidos.splice(0, perdidos.length, ...semCpf(perdidos));

    const vindoDoRemovido = descartar.find((d) => digitos(d.cpf) === cpfQueFica);
    if (vindoDoRemovido && digitos(manter.cpf) !== cpfQueFica) {
      absorvidos.push({ chave: 'cpf', rotulo: 'CPF', de: vindoDoRemovido });
    }
    for (const d of descartar) {
      if (temValor(d.cpf) && digitos(d.cpf) !== cpfQueFica) {
        perdidos.push({ chave: 'cpf', rotulo: 'CPF', de: d });
      }
    }
  }

  const filiacaoPreservada = descartar.reduce<CandidatoDuplicata | null>((melhor, d) => {
    if (!d.dataFiliacao) return melhor;
    if (manter.dataFiliacao && String(d.dataFiliacao) >= String(manter.dataFiliacao)) return melhor;
    if (melhor && String(melhor.dataFiliacao) <= String(d.dataFiliacao)) return melhor;
    return d;
  }, null);

  return { absorvidos, perdidos, filiacaoPreservada };
}

/**
 * O QUE O DÍGITO VERIFICADOR DIZ SOBRE DOIS CPFs QUE DIVERGEM.
 *
 * Vem pronto do servidor — a mesma função que decide se a fusão passa. A tela
 * não recalcula nada: duas implementações da mesma conta acabariam discordando
 * na hora de apagar cadastro.
 */
export interface AnaliseDeCpf {
  porCadastro: { id: string; matricula: string; cpf: string; valido: boolean }[];
  umSoValido: boolean;
  todosValidos: boolean;
  cpfBom: string | null;
}

/**
 * O QUE A TELA DEVE DIZER, E SE DÁ PARA CONSOLIDAR.
 *
 * CASO QUE ABRIU ISTO (18/09/2026) — LUANA DE GÓIS SILVA FERNANDES, matrículas
 * 4002 e 5811, com CPFs que diferem em UM dígito. O dono reconheceu o erro de
 * digitação e pediu para conseguir consolidar mesmo assim. Só que o CPF que a
 * tela ia MANTER era o inválido, e o que ela ia APAGAR era o válido: aceitar
 * cegamente a consolidação teria gravado o errado para sempre.
 *
 * Então a tela deixou de só barrar e passou a responder QUAL é o certo.
 */
export interface VeredictoDoCpf {
  /** A frase principal, em português, sobre o que os dígitos dizem. */
  titulo: string;
  /** O que fazer a respeito. */
  recado: string;
  /** Dá para consolidar? Falso quando os dois CPFs são válidos. */
  liberado: boolean;
  /** Já escolhido pelo sistema quando ele sabe; nulo quando a escolha é humana. */
  escolhaPadrao: string | null;
}

export function veredictoDoCpf(a: AnaliseDeCpf): VeredictoDoCpf {
  if (a.todosValidos) {
    return {
      titulo: 'Os dois CPFs são válidos.',
      recado:
        'Dois CPFs que passam no dígito verificador são duas pessoas. Se tiver certeza de que ' +
        'é a mesma, corrija o CPF errado na ficha e consolide depois — assim nada é apagado ' +
        'por engano.',
      liberado: false,
      escolhaPadrao: null,
    };
  }
  if (a.umSoValido) {
    const bom = a.porCadastro.find((c) => c.valido)!;
    const ruim = a.porCadastro.filter((c) => !c.valido);
    return {
      titulo: `Só ${mascararCpf(bom.cpf)} passa no dígito verificador.`,
      recado:
        `${ruim.map((c) => mascararCpf(c.cpf)).join(' e ')} não ` +
        `${ruim.length > 1 ? 'passam' : 'passa'} na ` +
        `conta — é erro de digitação. Ao consolidar, fica o da matrícula ${bom.matricula}, ` +
        'mesmo que seja o do cadastro que sai.',
      liberado: true,
      escolhaPadrao: soDigitosDoCpf(bom.cpf),
    };
  }
  return {
    titulo: 'Nenhum dos CPFs passa no dígito verificador.',
    recado: 'Os dois estão errados e não identificam ninguém. Escolha qual deve ficar.',
    liberado: true,
    escolhaPadrao: null,
  };
}

export const soDigitosDoCpf = (v: string) => v.replace(/[^0-9]/g, '');
