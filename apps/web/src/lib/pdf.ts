import type { AxiosResponse } from 'axios';
import { toast } from 'sonner';
import { api } from './api';

/**
 * O DOWNLOAD QUE FALHAVA EM SILÊNCIO — 24/09/2026.
 *
 * *"Clico em carteirinha e não acontece nada. Emitir carteirinha também não
 * acontece nada."* Não acontecia mesmo: `onClick={() => baixarPdf(…)}` devolve
 * uma promessa que ninguém espera, e quando ela é rejeitada o navegador engole.
 * Zero de 15 chamadas de download no sistema tinham tratamento — **nenhuma**.
 *
 * E havia uma segunda camada de mudez. Com `responseType: 'blob'`, o corpo de
 * ERRO também chega como Blob: `e.response.data.message` é `undefined`, e a
 * mensagem que o servidor escreveu com todo cuidado ("Carteirinha não emitida")
 * fica dentro de um objeto binário que ninguém abre. Aqui ele é lido.
 *
 * Quem chama não precisa mudar nada: a falha vira aviso na tela, e a promessa
 * resolve normalmente — porque o erro já foi comunicado, e relançar só
 * produziria o "unhandled rejection" que ninguém vê.
 */
async function mensagemDoErro(e: unknown, padrao: string): Promise<string> {
  const corpo = (e as { response?: { data?: unknown } })?.response?.data;
  if (corpo instanceof Blob) {
    try {
      const texto = await corpo.text();
      const json = JSON.parse(texto) as { message?: string | string[] };
      const m = Array.isArray(json.message) ? json.message.join(' ') : json.message;
      if (m && m.trim()) return m;
    } catch {
      // Corpo que não é JSON (HTML de proxy, resposta vazia): fica o padrão.
    }
  }
  const direto = (corpo as { message?: string } | undefined)?.message;
  return typeof direto === 'string' && direto.trim() ? direto : padrao;
}

/** Avisa na tela e NÃO relança: o clique já teve resposta. */
async function avisar(e: unknown, padrao: string): Promise<void> {
  toast.error(await mensagemDoErro(e, padrao));
}

/**
 * O NOME QUE O SERVIDOR MANDOU, lido do `Content-Disposition`.
 *
 * Prefere `filename*` (RFC 5987, percent-encoded em UTF-8) e cai para
 * `filename` quando ele não vem — é a ordem que a própria RFC 6266 manda, e é
 * o que faz "Termo de Desfiliação - MARIA APARECIDA.pdf" chegar com o "ç" e o
 * "ã" no lugar em vez de virar mojibake.
 *
 * Devolve `null` quando não há nome utilizável. Só é possível LER este
 * cabeçalho porque a API o declara em `exposedHeaders` — numa requisição
 * cross-origin o navegador esconde do script tudo o que não for cabeçalho
 * simples, sem avisar.
 */
export function nomeDoCabecalho(res: AxiosResponse): string | null {
  const bruto = String(res.headers?.['content-disposition'] ?? '');
  if (!bruto) return null;

  const estrela = bruto.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (estrela?.[1]) {
    try {
      return decodeURIComponent(estrela[1].trim());
    } catch {
      // Percent-encoding malformado: cai para o campo ASCII, que sempre vem.
    }
  }
  const simples = bruto.match(/filename\s*=\s*"([^"]+)"/i) ?? bruto.match(/filename\s*=\s*([^;]+)/i);
  return simples?.[1]?.trim() || null;
}

/**
 * Abre um PDF de endpoint protegido (que exige Authorization: Bearer).
 * Links <a href> normais não enviam o token, então buscamos via axios
 * como blob e navegamos a aba para o object URL.
 *
 * A aba é aberta de forma síncrona (no clique) para não ser bloqueada por
 * bloqueadores de pop-up; só então é redirecionada ao blob.
 *
 * ATENÇÃO AO QUE ESTA FUNÇÃO NÃO PODE FAZER
 * -----------------------------------------
 * O nome do arquivo NÃO sobrevive aqui. Um `blob:` não carrega cabeçalho
 * nenhum, e o visualizador de PDF do navegador, ao salvar, usa o último
 * pedaço da URL — que é o UUID do blob. Era exatamente essa a queixa: "vem com
 * o nome estranho e aleatório".
 *
 * Por isso: use `abrirPdf` quando a intenção é VER (um relatório que se
 * confere na hora e se descarta) e `baixarPdf` quando a intenção é OBTER o
 * documento — termo, carteirinha, crachá, certificado. Não há um terceiro
 * caminho: ou o arquivo é entregue com nome, ou é exibido sem nome.
 */
export async function abrirPdf(endpoint: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const res = await api.get(endpoint, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    if (win) win.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    await avisar(e, 'Não foi possível abrir o documento.');
  }
}

/**
 * Baixa um documento gerado pela API COM O NOME QUE ELA DEU.
 *
 * O nome sai do `Content-Disposition` da resposta — uma fonte só, no servidor,
 * onde estão os dados para montá-lo (o nome do filiado, o do evento, a data).
 * `nomeReserva` cobre o caso de o cabeçalho não chegar; melhor um nome
 * genérico do que um UUID.
 */
export async function baixarPdf(endpoint: string, nomeReserva = 'documento.pdf'): Promise<void> {
  try {
    const res = await api.get(endpoint, { responseType: 'blob' });
    entregar(res.data as Blob, nomeDoCabecalho(res) ?? nomeReserva);
  } catch (e) {
    await avisar(e, 'Não foi possível baixar o documento.');
  }
}

/** Baixa um arquivo de endpoint protegido (envia o token e força o download). */
export async function baixarArquivo(endpoint: string, nomeArquivo: string): Promise<void> {
  try {
    const res = await api.get(endpoint, { responseType: 'blob' });
    // O nome do servidor vence o passado pela tela: ele conhece o conteúdo.
    entregar(res.data as Blob, nomeDoCabecalho(res) ?? nomeArquivo);
  } catch (e) {
    await avisar(e, 'Não foi possível baixar o arquivo.');
  }
}

/** O `<a download>` é o único jeito de o navegador aceitar um nome para o blob. */
function entregar(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
