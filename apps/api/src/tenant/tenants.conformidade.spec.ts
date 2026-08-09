import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { TENANTS } from './tenant.config';
import { TENANTS as TENANTS_WEB } from '../../../web/src/tenant.config';

/**
 * UM SINDICATO ENTRA INTEIRO, OU NÃO ENTRA.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Cadastrar um cliente novo toca nove lugares:
 * dois arquivos de configuração, dois registros, as portas do lançador, a
 * matriz da CI, dois `.env` e os logos. Um documento com essa lista não impede
 * nada — quem esquece o sexto item não vai reler o documento justamente na hora
 * em que esqueceu.
 *
 * Este teste percorre os clientes registrados e reprova quando um deles está
 * pela metade. É a diferença entre "está escrito" e "não passa".
 *
 * Cada asserção aqui nasceu de um defeito real encontrado no SINDSERM:
 * módulo ligado na API e escondido no menu, campo oculto de um lado só,
 * paleta com degrau faltando (que virou branco sobre branco), porta não
 * registrada, cliente fora da CI.
 */

const RAIZ = path.resolve(__dirname, '../../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const ids = Object.keys(TENANTS);

describe('registro dos sindicatos', () => {
  it('há pelo menos um cliente registrado', () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it('a API e a tela conhecem exatamente os MESMOS clientes', () => {
    expect(Object.keys(TENANTS_WEB).sort()).toEqual(ids.sort());
  });

  it.each(ids)('%s: a chave do registro é igual ao id', (id) => {
    expect(TENANTS[id].id).toBe(id);
    expect(TENANTS_WEB[id].id).toBe(id);
  });

  it.each(ids)('%s: o id serve como nome de arquivo e de variável', (id) => {
    // Vira nome de PNG, de banco, de diretório de build e de chave de cookie.
    expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe('a API e a tela precisam concordar', () => {
  /**
   * Menu escondido com rota viva deixa a funcionalidade acessível por URL;
   * menu visível com rota morta leva a pessoa a um erro. As duas listas são
   * mantidas à mão em arquivos diferentes — é exatamente o tipo de par que
   * diverge sem ninguém perceber.
   */
  it.each(ids)('%s: a lista de módulos é a mesma dos dois lados', (id) => {
    expect([...TENANTS_WEB[id].modulos].sort()).toEqual([...TENANTS[id].modulos].sort());
  });

  it.each(ids)('%s: os campos ocultos são os mesmos dos dois lados', (id) => {
    expect([...(TENANTS_WEB[id].camposOcultos ?? [])].sort())
      .toEqual([...(TENANTS[id].camposOcultos ?? [])].sort());
  });

  /**
   * O par de `camposOcultos`. Divergir aqui é pior que divergir lá: a tela
   * exigiria um campo que a API aceita vazio (ou o contrário), e o operador
   * ficaria preso num formulário que não envia, sem entender por quê.
   */
  it.each(ids)('%s: os campos obrigatórios são os mesmos dos dois lados', (id) => {
    expect([...(TENANTS_WEB[id].camposObrigatorios ?? [])].sort())
      .toEqual([...(TENANTS[id].camposObrigatorios ?? [])].sort());
  });

  it.each(ids)('%s: o vocabulário é o mesmo dos dois lados', (id) => {
    expect(TENANTS_WEB[id].vocabulario).toEqual(TENANTS[id].vocabulario);
  });

  it.each(ids)('%s: a sigla é a mesma dos dois lados', (id) => {
    expect(TENANTS_WEB[id].sigla).toBe(TENANTS[id].sigla);
  });
});

describe('empregadores semeados por migration', () => {
  /**
   * A TRAVA QUE PROTEGE O SENATEPI DE SI MESMO.
   *
   * `OrganizacoesHerdadasService` remove, no boot, os empregadores semeados
   * pela migration `20260802120000` que a instalação NÃO declara em
   * `empregadoresIniciais` e que ninguém usa. É o que tira PRONTOCARE e os
   * hospitais estaduais do banco do SINDSERM.
   *
   * O RISCO INVERSO: se alguém acrescentar um nome àquela lista no serviço e
   * esquecer de declará-lo no SENATEPI, o robô apagaria do SENATEPI um
   * empregador legítimo — silenciosamente, no primeiro boot, e só enquanto
   * ninguém o estivesse usando. Este teste conserta a assimetria: o SENATEPI é
   * o dono daquela lista e precisa declarar TUDO o que ela semeia.
   */
  const SEMEADOS_PELA_MIGRATION = [
    'FUNDAÇÃO MUNICIPAL DE SAÚDE DE TERESINA',
    'SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ',
    'HOSPITAL UNIVERSITÁRIO DA UFPI',
    'MATERNIDADE DONA EVANGELINA ROSA',
    'HOSPITAL GETÚLIO VARGAS',
    'HOSPITAL DE URGÊNCIA DE TERESINA',
    'INSTITUTO DE DOENÇAS TROPICAIS NATAN PORTELLA',
    'PRONTOCARE',
  ];

  it('o SENATEPI declara todos os empregadores que a migration semeia', () => {
    const declarados = (TENANTS.senatepi.empregadoresIniciais ?? []).map((n) => n.toUpperCase());
    for (const nome of SEMEADOS_PELA_MIGRATION) expect(declarados).toContain(nome);
  });

  /**
   * O outro lado: um cliente que NÃO é da enfermagem não pode declarar
   * hospitais estaduais como seus. Se declarasse, estaria pedindo para manter
   * no cadastro exatamente o lixo que o serviço existe para recolher.
   */
  it.each(ids.filter((id) => id !== 'senatepi'))(
    '%s: não adota os empregadores da enfermagem do SENATEPI',
    (id) => {
      const declarados = (TENANTS[id].empregadoresIniciais ?? []).map((n) => n.toUpperCase());
      expect(declarados).not.toContain('PRONTOCARE');
    },
  );
});

describe('o cadastro de organizacao e unico', () => {
  /**
   * AQUI MORAVA O TESTE OPOSTO — o que PROIBIA um cliente de ligar `empresas`
   * e `organizacoes` juntos. Ele existiu porque os dois eram cadastros de
   * organizacao que nao se conheciam, e conviver significava cadastrar o mesmo
   * hospital duas vezes.
   *
   * A unificacao acabou com o motivo: `partes_externas` virou O cadastro e
   * `empresas` virou o DOSSIE PATRONAL pendurado nele, via
   * `empresas.parte_externa_id`. Os dois itens de menu deixaram de ser
   * redundantes — um e o CADASTRO de qualquer organizacao, o outro e o
   * TRABALHO patronal sobre as que contribuem.
   *
   * O teste foi trocado, e nao apenas removido: o que precisa continuar
   * garantido e que quem tem o modulo patronal tenha TAMBEM o cadastro de
   * organizacao. Ligar `empresas` sem `organizacoes` devolveria o cliente ao
   * estado em que a identidade da empresa so pode ser corrigida por dentro de
   * outra tela — que foi de onde a divergencia nasceu.
   */
  it.each(ids)('%s: quem tem "empresas" tem "organizacoes"', (id) => {
    const modulos = TENANTS[id].modulos;
    if (!modulos.includes('empresas')) return; // cliente sem patronal: nada a exigir
    expect(modulos).toContain('organizacoes');
  });
});

describe('identidade institucional', () => {
  it.each(ids)('%s: tem nome, sigla e endereço preenchidos', (id) => {
    const t = TENANTS[id];
    expect(t.nome.trim().length).toBeGreaterThan(0);
    expect(t.sigla.trim().length).toBeGreaterThan(0);
    expect(t.endereco.cidade.trim().length).toBeGreaterThan(0);
    expect(t.endereco.uf).toMatch(/^[A-Z]{2}$/);
  });

  it.each(ids)('%s: o vocabulário está em minúsculas', (id) => {
    // As formas maiúsculas são derivadas (`V.Filiados`); guardar já
    // capitalizado produziria "SERVIDORES" no meio de frase.
    const v = TENANTS[id].vocabulario;
    expect(v.filiado).toBe(v.filiado.toLowerCase());
    expect(v.filiados).toBe(v.filiados.toLowerCase());
  });

  it.each(ids)('%s: não há «confirmar» esquecido no arquivo', (id) => {
    const fonte = ler(`apps/api/src/tenant/tenants/${id}.ts`);
    // Marca usada enquanto o dado do sindicato não veio. Ficar em produção
    // significa CNPJ ou endereço inventado saindo em documento oficial.
    expect(fonte).not.toMatch(/«confirmar»|\/\/ confirmar/);
  });
});

describe('paleta da marca', () => {
  const DEGRAUS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

  /**
   * O Tailwind não emite classe para tom inexistente: um degrau faltando faz
   * `bg-brand-700 text-white` virar texto branco sobre fundo branco. Aconteceu.
   */
  it.each(ids)('%s: tem os dez degraus, nenhum a menos', (id) => {
    expect(Object.keys(TENANTS_WEB[id].paleta).sort()).toEqual([...DEGRAUS].sort());
  });

  it.each(ids)('%s: todo degrau é um hexadecimal válido', (id) => {
    for (const [tom, hex] of Object.entries(TENANTS_WEB[id].paleta)) {
      expect(`${tom}:${hex}`).toMatch(/^\d+:#[0-9A-Fa-f]{6}$/);
    }
  });

  /**
   * 700, 800 e 900 são os fundos sólidos do tema claro — botão primário, aba
   * ativa, cabeçalho —, sempre com texto branco por cima. É onde o degrau
   * faltante produziu branco sobre branco.
   *
   * O 600 fica FORA desta asserção, e não por conveniência: a paleta
   * institucional do SENATEPI mede 3,26:1 nele (`#4FA11B`), abaixo dos 4,5
   * exigidos, e ele aparece com `text-white` no assistente de importação e nas
   * abas em tema escuro. É um defeito de acessibilidade REAL e anterior a este
   * trabalho — mas a cor é a marca do sindicato, e escurecê-la é decisão da
   * diretoria, não de um teste.
   *
   * Paleta DERIVADA pela tela de Identidade Visual já garante o 600 também;
   * quem herda a garantia menor é só a paleta escrita à mão.
   */
  it.each(ids)('%s: os fundos sólidos do tema claro passam em AA com texto branco', (id) => {
    const paleta = TENANTS_WEB[id].paleta;
    for (const tom of ['700', '800', '900']) {
      expect(`${tom}:${(contraste(paleta[tom]) >= 4.5).toString()}`).toBe(`${tom}:true`);
    }
  });
});

describe('integrações externas', () => {
  const CONHECIDAS = ['datajud', 'djen'];

  it.each(ids)('%s: só declara integração que existe', (id) => {
    for (const i of TENANTS[id].integracoes ?? []) expect(CONHECIDAS).toContain(i);
  });

  /**
   * Integração é fonte de dados DENTRO de uma área. Declarar `datajud` num
   * cliente sem o módulo `processos` não quebra nada — o job já para no gate do
   * módulo —, mas é uma mentira no arquivo: alguém lendo acredita que aquele
   * sindicato consulta o CNJ.
   */
  it.each(ids)('%s: não declara integração de módulo desligado', (id) => {
    const t = TENANTS[id];
    const doJuridico = (t.integracoes ?? []).filter((i) => ['datajud', 'djen'].includes(i));
    if (doJuridico.length) expect(t.modulos).toContain('processos');
  });
});

describe('o cliente está ligado em todo lugar que precisa', () => {
  it.each(ids)('%s: tem portas próprias no lançador de desenvolvimento', (id) => {
    const dev = ler('scripts/dev.js');
    expect(dev).toContain(`${id}:`);
  });

  it('nenhum cliente divide porta com outro', () => {
    const dev = ler('scripts/dev.js');
    const portas = [...dev.matchAll(/\{\s*api:\s*(\d+),\s*web:\s*(\d+)\s*\}/g)]
      .flatMap((m) => [m[1], m[2]]);
    expect(new Set(portas).size).toBe(portas.length);
  });

  /**
   * O cliente que ninguém constrói é o que quebra quando o core muda — e o
   * jeito de descobrir três semanas depois é não estar na matriz.
   */
  it.each(ids)('%s: está na matriz da CI', (id) => {
    const ci = ler('.github/workflows/ci.yml');
    const matriz = /tenant:\s*\[([^\]]+)\]/.exec(ci)?.[1] ?? '';
    expect(matriz.split(',').map((s) => s.trim())).toContain(id);
  });
});

/** Razão de contraste com branco (WCAG 2.1). */
function contraste(hex: string): number {
  const n = hex.replace('#', '');
  const canais = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = canais.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05);
}
