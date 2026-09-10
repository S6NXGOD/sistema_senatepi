/**
 * Endereço: ViaCEP + UFs + municípios do IBGE.
 *
 * Duas APIs públicas, ambas usadas como CONVENIÊNCIA — nunca como obrigação.
 * Se o CEP não for encontrado ou o serviço estiver fora do ar, o formulário
 * continua preenchível à mão. Ninguém deixa de ser cadastrado no balcão porque
 * um serviço externo caiu.
 */

/** As 27 unidades federativas. Lista fixa: não muda e não vale uma chamada. */
export const UFS = [
  { sigla: 'AC', nome: 'Acre' }, { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' }, { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' }, { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' }, { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' }, { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' }, { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' }, { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' }, { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' }, { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' }, { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' }, { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' }, { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' }, { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' },
] as const;

/** Máscara 00000-000. */
export function mascararCep(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export interface EnderecoViaCep {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
  /** O CEP existe mas é genérico (de cidade) — logradouro/bairro vêm vazios. */
  parcial: boolean;
}

/**
 * Consulta o ViaCEP. Devolve `null` quando o CEP não existe, está incompleto
 * ou o serviço falhou — o chamador simplesmente não preenche nada.
 *
 * Não lança: uma falha de rede aqui não pode quebrar o formulário.
 */
export async function buscarCep(cepBruto: string): Promise<EnderecoViaCep | null> {
  const cep = (cepBruto || '').replace(/\D/g, '');
  if (cep.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) return null;
    const d = await res.json();
    if (d?.erro) return null;
    return {
      cep,
      logradouro: d.logradouro ?? '',
      bairro: d.bairro ?? '',
      cidade: d.localidade ?? '',
      uf: (d.uf ?? '').toUpperCase(),
      // CEP único de cidade não traz rua — a tela avisa em vez de fingir sucesso.
      parcial: !d.logradouro,
    };
  } catch {
    return null;
  }
}

/**
 * Municípios de uma UF, para o autocomplete da cidade.
 *
 * PASSOU A LER O CATÁLOGO DO PRÓPRIO SISTEMA, e não mais a API do IBGE direto
 * do navegador. A razão não é desempenho — é que a chamada antiga devolvia só o
 * NOME, e nome não identifica município no Brasil: 240 nomes se repetem entre
 * estados. O catálogo local é o mesmo dado do IBGE, carregado no boot, com o
 * código junto e a grafia oficial.
 *
 * E a grafia oficial é o que conserta o problema pela raiz: o cadastro tem sete
 * escritas de Teresina porque o campo aceitava qualquer coisa. Escolhendo desta
 * lista, o que entra no banco já casa com o catálogo na primeira tentativa.
 *
 * A QUEDA PARA O IBGE CONTINUA existindo para o caso de a instalação não ter o
 * módulo `municipios` ligado (a rota responde 404) — aí o campo funciona como
 * sempre funcionou, em vez de ficar vazio.
 */
const cacheMunicipios = new Map<string, string[]>();

export async function municipiosDaUF(uf: string): Promise<string[]> {
  const sigla = (uf || '').toUpperCase();
  if (sigla.length !== 2) return [];
  const cacheado = cacheMunicipios.get(sigla);
  if (cacheado) return cacheado;

  try {
    const { municipiosDaUFPelaApi } = await import('@/lib/municipios');
    const doCatalogo = await municipiosDaUFPelaApi(sigla);
    if (doCatalogo.length) {
      const nomes = doCatalogo.map((m) => m.nome);
      cacheMunicipios.set(sigla, nomes);
      return nomes;
    }
  } catch {
    /* Sem módulo, sem sessão ou API fora: cai para a fonte pública abaixo. */
  }

  try {
    const res = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${sigla}/municipios`,
    );
    if (!res.ok) return [];
    const d = (await res.json()) as { nome: string }[];
    const nomes = d.map((m) => m.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    cacheMunicipios.set(sigla, nomes);
    return nomes;
  } catch {
    return [];
  }
}
