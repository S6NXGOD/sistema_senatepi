import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { PainelDeAvisos, resumoDosAvisos, type TomDoAviso } from './painel-de-avisos';

/**
 * O QUADRO DE AVISOS CHEGA RECOLHIDO — 09/11/2026.
 *
 * O dono: *"Ainda estou achando poluído a dashboard, quero que possamos recolher
 * esses avisos e por padrão ele venha recolhido."* Recolhido, o quadro é uma
 * linha com uma pílula por tom; aberto, é o quadro de 07/11.
 *
 * O estado inicial é conferido RENDERIZANDO o componente, não lendo o fonte. A
 * contagem que alimenta as pílulas lê o DOM do navegador (`MutationObserver`),
 * que este ambiente não tem — ela foi conferida no Chrome, e aqui fica a regra
 * pura que a transforma em texto.
 */

const RAIZ = path.resolve(__dirname, '../..');
const semComentarios = (src: string) =>
  src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const ler = (rel: string) => semComentarios(readFileSync(path.join(RAIZ, rel), 'utf8'));

const textos = (tons: TomDoAviso[]) => resumoDosAvisos(tons).map((p) => p.texto);

describe('o resumo do quadro recolhido', () => {
  /** O painel do print do dono: Diário, contas públicas, ação nova, CNJ, desconhecidos, paradas. */
  it('conta por tom, com plural de verdade', () => {
    expect(textos(['atencao', 'atencao', 'atencao', 'info', 'info', 'info'])).toEqual([
      '3 pedem atenção',
      '3 informativos',
    ]);
    expect(textos(['atencao', 'info'])).toEqual(['1 pede atenção', '1 informativo']);
  });

  /** Quem bate o olho precisa ver primeiro se algo quebrou — a ordem é a da gravidade. */
  it('do mais grave ao mais leve, qualquer que seja a ordem na tela', () => {
    expect(resumoDosAvisos(['info', 'atencao', 'critico', 'atencao']).map((p) => p.tom)).toEqual([
      'critico',
      'atencao',
      'info',
    ]);
    expect(textos(['critico', 'critico'])).toEqual(['2 com falha']);
  });

  /** "0 com falha" seria o sistema avisando que não tem o que avisar. */
  it('tom que não existe não ganha pílula', () => {
    expect(resumoDosAvisos([])).toEqual([]);
    expect(textos(['info', 'info'])).toEqual(['2 informativos']);
  });
});

describe('o quadro na tela', () => {
  const html = renderToStaticMarkup(
    createElement(
      PainelDeAvisos,
      null,
      createElement('div', { 'data-aviso': 'atencao' }, 'O sistema não conclui a busca no Diário'),
    ),
  );

  it('chega recolhido', () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('>Mostrar<');
    const corpo = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(corpo).toBeTruthy();
    expect(html).toMatch(new RegExp(`<div id="${corpo}" hidden=""`));
  });

  /*
    RECOLHER NÃO DESMONTA: o aviso continua na página, escondido. É isso que
    deixa a contagem existir com o quadro fechado e as consultas de cada bloco
    seguirem vivas.
  */
  it('mas o aviso continua montado lá dentro', () => {
    expect(html).toContain('data-aviso="atencao"');
    expect(html).toContain('O sistema não conclui a busca no Diário');
  });

  it('e a linha inteira é o botão, com o cabeçalho de seção em volta', () => {
    expect(html).toMatch(/<h2><button type="button" aria-expanded="false"/);
  });

  /** Em dia tranquilo o quadro some — recolhido ou não, não sobra uma linha "Avisos" vazia. */
  it('continua sumindo quando nenhum aviso desenhou nada', () => {
    expect(html).toContain('[&amp;:not(:has([data-aviso]))]:hidden');
  });
});

describe('o que o fonte garante', () => {
  /*
    "POR PADRÃO RECOLHIDO" É A CADA VISITA. Guardar o último estado no navegador
    faria o quadro abrir sozinho para sempre depois do primeiro clique.
  */
  it('o quadro não guarda o estado aberto', () => {
    const quadro = ler('components/dashboard/painel-de-avisos.tsx');
    expect(quadro).toContain('useState(false)');
    expect(quadro).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  /*
    A LINHA RESUMIDA DO ROBÔ ERA UM `<p>` SEM `data-aviso`: sozinha, o quadro
    não a via e se escondia com ela dentro; acompanhada, ficava fora da
    contagem. Agora é a linha `info` padrão.
  */
  it('a linha do robô no painel de carteira é um aviso do quadro', () => {
    const pagina = ler('app/(dashboard)/dashboard/page.tsx');
    const ramo = pagina.indexOf("if (resumido && (situacao === 'SEM_OBJETO' || situacao === 'EM_DIA')) {");
    expect(ramo).toBeGreaterThan(-1);
    const corpo = pagina.slice(ramo);
    const desenha = corpo.indexOf('return (');
    expect(corpo.slice(desenha, desenha + 80)).toMatch(/return \(\s*<AlertBar tom="info"/);
  });
});
