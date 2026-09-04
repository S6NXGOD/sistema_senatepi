import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ler = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const lerCodigo = (rel: string) =>
  ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SERVICO = lerCodigo('agenda.service.ts');
const DTO = lerCodigo('dto/agenda.dto.ts');

/**
 * "COMO ESTÃO O MURILO E A SHÉRAD ESTA SEMANA?"
 *
 * O filtro respondia só "de UMA pessoa" — comparar duas carteiras exigia
 * filtrar uma, anotar, filtrar a outra. São oito pessoas com atividade na
 * produção; a coordenação olha de duas em duas.
 */
describe('filtrar por vários responsáveis', () => {
  it('o DTO recebe a lista', () => {
    expect(DTO).toContain('responsaveis?: string;');
  });

  /**
   * VÍRGULA, e não `campo[]=a&campo[]=b`: a notação de colchete depende de como
   * o `qs` do Express está configurado e de como o cliente serializa. As duas
   * pontas discordarem dá o pior resultado possível — um filtro que a tela
   * mostra ativo e a API ignora, devolvendo a agenda inteira como se fosse a de
   * uma pessoa só.
   */
  it('a lista é separada por vírgula', () => {
    expect(SERVICO).toContain("...(q.responsaveis?.split(',') ?? [])");
  });

  it('soma com o filtro de um só, sem repetir', () => {
    expect(SERVICO).toContain('[q.responsavelId, ...(q.responsaveis');
    expect(SERVICO).toContain('new Set(');
  });

  /**
   * RESPONSÁVEL **OU** EQUIPE, para cada pessoa. É o ponto inteiro da
   * multivinculação: o segundo advogado de uma audiência precisa vê-la na
   * própria agenda.
   */
  it('cada pessoa entra pelas duas portas', () => {
    expect(SERVICO).toContain('OR: pessoas.flatMap((id) => [');
    expect(SERVICO).toContain('{ responsavelId: id }');
    expect(SERVICO).toContain('{ equipe: { some: { usuarioId: id } } }');
  });

  it('e dá para pedir só as urgentes', () => {
    expect(DTO).toContain('urgente?: string;');
    expect(SERVICO).toContain("if (q.urgente === 'true') and.push({ urgente: true });");
  });
});

/**
 * O FILTRO NÃO MUDA QUEM PODE VER O QUÊ.
 *
 * `responsaveis` é recorte de LEITURA sobre a mesma listagem que já existia:
 * quem alcança `GET /compromissos` alcançava a agenda inteira antes e continua
 * alcançando. Se um dia a agenda passar a ser privada por pessoa, o corte tem
 * de ser no serviço — como já é em Relatórios, onde o ADVOGADO só vê os
 * próprios números.
 */
describe('o recorte não é permissão', () => {
  it('a listagem segue no gate de módulo da agenda', () => {
    const CONTROLLER = lerCodigo('agenda.controller.ts');
    expect(CONTROLLER).toContain("@Modulo('agenda')");
  });
});
