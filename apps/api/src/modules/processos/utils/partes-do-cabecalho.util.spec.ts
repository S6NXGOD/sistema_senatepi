import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lerPartesDoCabecalho,
  completarPolosQueFaltam,
} from './partes-do-cabecalho.util';
import { deQuemEAOrdem, deQuemEOPrazo } from './de-quem-e-a-ordem.util';

/**
 * O CABEÇALHO DO ATO, LIDO COM ATOS DE VERDADE.
 *
 * Todo teor aqui é recorte de publicação real do acervo em 31/10/2026. A
 * pergunta que o arquivo responde é a do dono: "por que não aparece os polos
 * ativos e passivos?" — e a resposta é que o Diário só manda os destinatários
 * das cópias endereçadas a nós, enquanto o cabeçalho do ato nomeia os dois.
 */
describe('as partes que o cabeçalho do ato nomeia', () => {
  it('lê AUTOR e RÉU do Juizado (TJPI)', () => {
    const lidas = lerPartesDoCabecalho(
      'PROCESSO Nº: 0805944-21.2026.8.18.0176 CLASSE: PROCEDIMENTO DO JUIZADO ESPECIAL ' +
        'CÍVEL (436) ASSUNTO: [Direito de Imagem] AUTOR: CARLOS ALBERTO AMORIM DE SOUSA ' +
        'ANDRADE REU: ERICK RICCELY PEREIRA DO O',
    );
    expect(lidas).toEqual([
      { polo: 'A', nome: 'CARLOS ALBERTO AMORIM DE SOUSA ANDRADE', rotulo: 'AUTOR' },
      { polo: 'P', nome: 'ERICK RICCELY PEREIRA DO O', rotulo: 'REU' },
    ]);
  });

  it('lê POLO ATIVO / POLO PASSIVO da Justiça Federal', () => {
    const lidas = lerPartesDoCabecalho(
      'Subseção Judiciária de Parnaíba-PI PROCESSO: 1005301-54.2026.4.01.4002 CLASSE: ' +
        'PROCEDIMENTO COMUM CÍVEL (7) POLO ATIVO: SINDICATO DOS ENFERMEIROS DO PIAUI ' +
        'POLO PASSIVO: MUNICIPIO DE JOAQUIM PIRES',
    );
    expect(lidas.map((x) => `${x.polo}:${x.nome}`)).toEqual([
      'A:SINDICATO DOS ENFERMEIROS DO PIAUI',
      'P:MUNICIPIO DE JOAQUIM PIRES',
    ]);
  });

  it('entende o vocabulário do mandado de segurança', () => {
    const lidas = lerPartesDoCabecalho(
      'PROCESSO Nº: 0800479-61.2024.8.18.0027 CLASSE: MANDADO DE SEGURANÇA COLETIVO ' +
        'IMPETRANTE: SINDICATO DOS ENFERMEIROS IMPETRADO: MUNICIPIO DE CORRENTE',
    );
    expect(lidas.map((x) => x.polo)).toEqual(['A', 'P']);
    expect(lidas[1].rotulo).toBe('IMPETRADO');
  });

  /*
    AQUI MORA O DEFEITO QUE O DONO VIU. A lista do TRF1 emenda os destinatários
    do DJEN logo depois do nome do réu — e sem o corte o réu do processo saía
    com o nome do próprio sindicato colado no fim.
  */
  it('para no "Destinatários:" do próprio Diário', () => {
    const lidas = lerPartesDoCabecalho(
      'POLO PASSIVO: MUNICIPIO DE JOAQUIM PIRES e outros Destinatários: SINDICATO DOS ' +
        'ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI',
    );
    expect(lidas).toEqual([
      { polo: 'P', nome: 'MUNICIPIO DE JOAQUIM PIRES e outros', rotulo: 'POLO PASSIVO' },
    ]);
  });

  it('"e outros" FICA — é o ato avisando que a lista não acabou', () => {
    const [passivo] = lerPartesDoCabecalho(
      'POLO PASSIVO: MUNICIPIO DE CAMPINAS DO PIAUI e outros REPRESENTANTES: JOSE DA SILVA',
    );
    expect(passivo.nome).toBe('MUNICIPIO DE CAMPINAS DO PIAUI e outros');
  });

  it('para quando o teor começa sem rótulo nenhum', () => {
    const [passivo] = lerPartesDoCabecalho(
      'RÉU: IJC OFTALMOS LTDA NOTIFICAÇÃO DE RECLAMANTE AUDIÊNCIA INICIAL TELEPRESENCIAL ' +
        'Fica a parte reclamante notificada para comparecer',
    );
    expect(passivo.nome).toBe('IJC OFTALMOS LTDA');
  });

  it('não inventa nada quando o cabeçalho não nomeia ninguém', () => {
    expect(lerPartesDoCabecalho('PODER JUDICIÁRIO JUSTIÇA DO TRABALHO ATOrd 0001-11')).toEqual([]);
    expect(lerPartesDoCabecalho('')).toEqual([]);
    expect(lerPartesDoCabecalho(null)).toEqual([]);
  });

  /*
    RECURSO NÃO ENTRA, e esta é a mesma regra que `de-quem-e-a-ordem.util` já
    aplica: RECORRENTE/RECORRIDO é posição RECURSAL, não polo da ação. Num
    recurso da empresa contra nós, o sindicato AUTOR é o RECORRIDO — mapear
    pelo polo trocaria os dois lados da ficha.
  */
  it('ignora RECORRENTE e AGRAVANTE: é posição recursal, não polo', () => {
    expect(
      lerPartesDoCabecalho('RECORRENTE: MED IMAGEM S/C RECORRIDO: SINDICATO DOS ENFERMEIROS'),
    ).toEqual([]);
    expect(lerPartesDoCabecalho('AGRAVANTE: MUNICIPIO DE PARNAIBA AGRAVADO: SENATEPI')).toEqual([]);
  });

  it('um rótulo repetido não vira duas leituras do mesmo polo', () => {
    const lidas = lerPartesDoCabecalho(
      'REU: MUNICIPIO DE SAO JOAO REU: ESTADO DO PIAUI AUTOR: SINDICATO DOS ENFERMEIROS',
    );
    expect(lidas.filter((x) => x.polo === 'P')).toHaveLength(1);
    expect(lidas.filter((x) => x.polo === 'A')).toHaveLength(1);
  });

  it('descarta trecho sem letra: número de processo não é nome', () => {
    expect(lerPartesDoCabecalho('AUTOR: 0001347-25.2023 REU: 55')).toEqual([]);
  });
});

describe('completar só o lado que falta', () => {
  const ATO =
    'PROCESSO Nº: 0801449-11.2022.8.18.0034 CLASSE: AÇÃO CIVIL COLETIVA (63) ' +
    'AUTOR: SINDICATO DOS ENFERMEIROS REU: MUNICIPIO DE HUGO NAPOLEAO';

  it('devolve o polo ausente quando os destinatários cobrem um só', () => {
    expect(completarPolosQueFaltam(ATO, ['A'])).toEqual([
      { polo: 'P', nome: 'MUNICIPIO DE HUGO NAPOLEAO', rotulo: 'REU' },
    ]);
    expect(completarPolosQueFaltam(ATO, ['P'])).toEqual([
      { polo: 'A', nome: 'SINDICATO DOS ENFERMEIROS', rotulo: 'AUTOR' },
    ]);
  });

  /*
    CALA-SE QUANDO JÁ SABEMOS. Repetir na tela o que a ficha já mostra é
    barulho, e barulho em formulário vira chamado — a mesma régua do bloco
    vazio que virou defeito na Agenda.
  */
  it('não diz nada quando os dois lados já vieram do Diário', () => {
    expect(completarPolosQueFaltam(ATO, ['A', 'P'])).toEqual([]);
  });

  it('com destinatário sem polo legível, trata como se não tivesse nenhum', () => {
    const faltam = completarPolosQueFaltam(ATO, ['T', '', null]);
    expect(faltam.map((x) => x.polo).sort()).toEqual(['A', 'P']);
  });
});

/**
 * UM LEITOR SÓ PARA "QUEM FOI O DESTINATÁRIO".
 *
 * Em 29/10/2026 a regra da proximidade foi escrita em `quemFoiIntimado` e o
 * irmão `ladoDoDestinatario` ficou com `if (ativo && passivo) return 'NOSSA'`.
 * Resultado medido na produção: a MESMA frase recebia DA_OUTRA_PARTE de um e
 * NOSSA do outro — e quem decide se a tarefa nasce é o segundo. Nasceu
 * "Juntar documentos", urgente, para obrigação da empresa ré.
 *
 * Este teste conta os leitores. Um terceiro `PAPEL_ATIVO.test(...)` ao lado de
 * um `PAPEL_PASSIVO.test(...)` reprova o arquivo.
 */
describe('a leitura do destinatário não se duplica', () => {
  /** O ato real que separava os dois leitores (TRT22, 2ª Vara, 26/10/2026). */
  const O_ATO =
    'NOTIFIQUE-SE O RECLAMADO PARA APRESENTAR OS DOCUMENTOS INDICADOS PELO SINDICATO ' +
    'AUTOR (ID 384EFDA), NO PRAZO DE 5 DIAS, SOB PENA DE MULTA NO VALOR DE R$ 5.000,00.';

  /*
    O TESTE QUE IMPORTA É DE COMPORTAMENTO, não de fonte: somos o AUTOR, quem
    foi notificado é o RECLAMADO, e os dois leitores têm de dizer a mesma coisa.
    Antes de 31/10/2026 o prazo dizia DA_OUTRA_PARTE e a ordem dizia NOSSA — e
    quem decide se a tarefa nasce é a ordem.
  */
  it('ordem e prazo dão o MESMO veredito na frase que os separava', () => {
    expect(deQuemEAOrdem(O_ATO, 'ATIVO', 'SENATEPI')).toBe('DA_OUTRA_PARTE');
    expect(deQuemEOPrazo(O_ATO, 'ATIVO', 'SENATEPI')).toBe('DA_OUTRA_PARTE');
  });

  it('e quando o reclamado é NOSSO lado, os dois dizem que é nossa', () => {
    expect(deQuemEAOrdem(O_ATO, 'PASSIVO', 'SENATEPI')).toBe('NOSSA');
    expect(deQuemEOPrazo(O_ATO, 'PASSIVO', 'SENATEPI')).toBe('NOSSO');
  });

  it('a conjunção continua obrigando os dois', () => {
    const ambos = 'INTIME-SE AS PARTES EMBARGADAS (RECLAMANTE E RECLAMADA) NO PRAZO DE 5 DIAS';
    expect(deQuemEAOrdem(ambos, 'ATIVO', 'SENATEPI')).toBe('NOSSA');
    expect(deQuemEOPrazo(ambos, 'ATIVO', 'SENATEPI')).toBe('NOSSO');
  });

  /*
    E `ladoDoDestinatario` NÃO PODE VOLTAR A COMPARAR OS PAPÉIS POR CONTA. Ele
    tem de delegar — é essa delegação que mantém os dois leitores iguais. A
    varredura da frase INTEIRA, lá embaixo em `deQuemEOPrazo`, é outra pergunta
    e fica onde está: sem verbo não há "mais perto do verbo".
  */
  it('`ladoDoDestinatario` delega, não compara', () => {
    const fonte = readFileSync(join(__dirname, 'de-quem-e-a-ordem.util.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const inicio = fonte.indexOf('function ladoDoDestinatario');
    expect(inicio).toBeGreaterThan(0);
    const corpo = fonte.slice(inicio, fonte.indexOf('\nexport ', inicio));
    expect(corpo).toContain('papelMaisPertoDoVerbo(d)');
    expect(corpo).not.toMatch(/PAPEL_(ATIVO|PASSIVO)\./);
  });
});
