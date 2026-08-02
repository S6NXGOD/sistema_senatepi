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
 * Municípios de uma UF (IBGE), para o autocomplete da cidade.
 *
 * São 5.570 municípios no Brasil — embutir tudo no bundle seria peso morto.
 * Buscar por UF traz algumas centenas, e o cache em memória evita repetir a
 * chamada enquanto a aba estiver aberta. Falhou? Devolve lista vazia e o campo
 * vira texto livre.
 */
const cacheMunicipios = new Map<string, string[]>();

export async function municipiosDaUF(uf: string): Promise<string[]> {
  const sigla = (uf || '').toUpperCase();
  if (sigla.length !== 2) return [];
  const cacheado = cacheMunicipios.get(sigla);
  if (cacheado) return cacheado;
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
