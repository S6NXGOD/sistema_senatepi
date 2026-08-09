import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as Papa from 'papaparse';

/**
 * LEITURA DE PLANILHA — XLSX ou CSV — para uma lista de objetos.
 *
 * Um só ponto de entrada porque, do ponto de vista de quem importa, o formato
 * do arquivo é acidente: a Prefeitura manda .xlsx, alguém reexporta como .csv
 * no meio do caminho, e o conteúdo é o mesmo. Fazer o operador saber disso
 * seria transferir um problema nosso para ele.
 *
 * `exceljs` já era dependência (gera os relatórios .xlsx), então ler xlsx não
 * custou biblioteca nova.
 */

export interface PlanilhaLida {
  /** Cabeçalhos na ordem original, como vieram no arquivo. */
  cabecalhos: string[];
  /** Uma entrada por linha de dados, com o cabeçalho ORIGINAL como chave. */
  linhas: Record<string, string>[];
}

/** Extensões aceitas — o resto é recusado antes de qualquer processamento. */
const EXTENSOES = ['.xlsx', '.xls', '.csv', '.txt'];

/**
 * Teto de linhas.
 *
 * A folha real tem ~4.000. O limite existe para que um arquivo errado (um dump
 * de 2 milhões de linhas arrastado por engano) falhe rápido e com mensagem, em
 * vez de consumir a memória do processo e derrubar a API para todo mundo.
 */
const MAX_LINHAS = 50_000;

export function extensaoSuportada(nomeArquivo: string): boolean {
  const nome = (nomeArquivo ?? '').toLowerCase();
  return EXTENSOES.some((e) => nome.endsWith(e));
}

/**
 * Célula do Excel → texto.
 *
 * O caso que exige cuidado é a MATRÍCULA: o Excel guarda "0012345" como número
 * 12345 e devolve um `number`. Converter com `String()` já resolve, mas datas e
 * fórmulas voltam como objeto — daí o tratamento por tipo. Sem isto, uma
 * matrícula viraria "[object Object]" e a linha inteira seria descartada.
 */
function celulaParaTexto(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'object') {
    const v = valor as unknown as Record<string, unknown>;
    // Fórmula: interessa o resultado, não a fórmula.
    if ('result' in v) return celulaParaTexto(v.result as ExcelJS.CellValue);
    // Texto rico (pedaços com formatação diferente na mesma célula).
    if ('richText' in v && Array.isArray(v.richText))
      return (v.richText as { text: string }[]).map((p) => p.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    if ('hyperlink' in v && 'text' in v) return String(v.text).trim();
  }
  return String(valor).trim();
}

/**
 * Onde começa a tabela.
 *
 * Planilhas de órgão público quase nunca começam na linha 1: vêm com brasão,
 * título ("RELAÇÃO DE SERVIDORES — COMPETÊNCIA 08/2026") e uma linha em branco
 * antes do cabeçalho. Assumir a linha 1 faria o importador ler "brasão" como
 * nome de coluna e recusar o arquivo inteiro.
 *
 * Heurística: dentro das 15 primeiras linhas, a primeira que tiver ao menos 3
 * células não vazias é o cabeçalho. É simples e cobre o formato real; se um dia
 * não cobrir, o erro aparece na tela de mapeamento, que mostra o que foi lido.
 */
function acharCabecalho(ws: ExcelJS.Worksheet): number {
  const limite = Math.min(ws.rowCount, 15);
  for (let i = 1; i <= limite; i++) {
    const preenchidas = (ws.getRow(i).values as ExcelJS.CellValue[])
      .filter((v) => celulaParaTexto(v) !== '').length;
    if (preenchidas >= 3) return i;
  }
  return 1;
}

async function lerXlsx(buffer: Buffer): Promise<PlanilhaLida> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException(
      'Não foi possível abrir a planilha. Verifique se o arquivo é um .xlsx válido ' +
        '(arquivos .xls antigos precisam ser salvos como .xlsx no Excel).',
    );
  }

  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount === 0) throw new BadRequestException('A planilha está vazia.');

  const linhaCabecalho = acharCabecalho(ws);
  const cabecalhos: string[] = [];
  ws.getRow(linhaCabecalho).eachCell({ includeEmpty: true }, (cell, col) => {
    cabecalhos[col - 1] = celulaParaTexto(cell.value);
  });
  // Colunas sem título viram "coluna_N": guardar a posição é melhor que perder
  // a coluna, e o mapeamento na tela mostra o que sobrou sem uso.
  for (let i = 0; i < cabecalhos.length; i++) {
    if (!cabecalhos[i]) cabecalhos[i] = `coluna_${i + 1}`;
  }

  const linhas: Record<string, string>[] = [];
  for (let i = linhaCabecalho + 1; i <= ws.rowCount; i++) {
    if (linhas.length >= MAX_LINHAS) break;
    const row = ws.getRow(i);
    const obj: Record<string, string> = {};
    let algumPreenchido = false;
    for (let c = 0; c < cabecalhos.length; c++) {
      const texto = celulaParaTexto(row.getCell(c + 1).value);
      obj[cabecalhos[c]] = texto;
      if (texto !== '') algumPreenchido = true;
    }
    // Linha totalmente vazia (comum no fim de planilha) não é registro.
    if (algumPreenchido) linhas.push(obj);
  }

  return { cabecalhos, linhas };
}

function lerCsv(buffer: Buffer): PlanilhaLida {
  // UTF-8 primeiro; com caractere de substituição, refaz em latin1 — é o
  // encoding em que sistemas legados daqui costumam exportar.
  let conteudo = buffer.toString('utf8');
  if (conteudo.includes('�')) conteudo = buffer.toString('latin1');
  conteudo = conteudo.replace(/^﻿/, ''); // BOM

  const parsed = Papa.parse<Record<string, string>>(conteudo, {
    header: true,
    skipEmptyLines: true,
    delimiter: '', // autodetecta , ; \t
  });
  const cabecalhos = parsed.meta.fields ?? [];
  if (cabecalhos.length === 0)
    throw new BadRequestException('CSV sem cabeçalho reconhecível.');

  const linhas = parsed.data.slice(0, MAX_LINHAS).map((row) => {
    const obj: Record<string, string> = {};
    for (const h of cabecalhos) obj[h] = (row[h] ?? '').toString().trim();
    return obj;
  });
  return { cabecalhos, linhas };
}

/**
 * Só os cabeçalhos — para decidir QUAL importador vai tratar o arquivo antes de
 * processá-lo.
 *
 * No CSV custa uma linha (`preview: 1`). No xlsx é preciso abrir o arquivo, e
 * abrir duas vezes uma planilha de 4.000 linhas custa cerca de um segundo — o
 * preço de não obrigar o operador a declarar o tipo do arquivo num combo que
 * ele erraria. Se um dia incomodar, o caminho é o upload devolver a planilha
 * já lida; hoje não vale a complexidade.
 */
export async function lerCabecalhos(file: {
  originalname: string;
  buffer: Buffer;
}): Promise<string[]> {
  if (!extensaoSuportada(file.originalname)) return [];
  if (/\.xlsx?$/i.test(file.originalname)) {
    try {
      return (await lerXlsx(file.buffer)).cabecalhos;
    } catch {
      return [];
    }
  }
  let conteudo = file.buffer.toString('utf8');
  if (conteudo.includes('�')) conteudo = file.buffer.toString('latin1');
  const parsed = Papa.parse<Record<string, string>>(conteudo.replace(/^﻿/, ''), {
    header: true,
    preview: 1,
    skipEmptyLines: true,
    delimiter: '',
  });
  return parsed.meta.fields ?? [];
}

export async function lerPlanilha(file: {
  originalname: string;
  buffer: Buffer;
}): Promise<PlanilhaLida> {
  if (!extensaoSuportada(file.originalname))
    throw new BadRequestException(
      `Formato não suportado. Envie um arquivo ${EXTENSOES.join(', ')}.`,
    );

  const ehExcel = /\.xlsx?$/i.test(file.originalname);
  const lida = ehExcel ? await lerXlsx(file.buffer) : lerCsv(file.buffer);

  if (lida.linhas.length === 0)
    throw new BadRequestException('O arquivo não tem nenhuma linha de dados.');

  return lida;
}
