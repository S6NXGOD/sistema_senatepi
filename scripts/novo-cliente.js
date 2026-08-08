#!/usr/bin/env node
/**
 * NASCE UM SINDICATO.
 *
 *     npm run novo-cliente
 *
 * Pergunta o que só o sindicato sabe e escreve TODOS os pontos de cadastro de
 * uma vez. Depois disso, `npm run dev:<id>` sobe o cliente novo.
 *
 * POR QUE UM SCRIPT, E NÃO UM DOCUMENTO. Cadastrar um cliente toca nove
 * lugares. Um documento com essa lista não impede nada: quem esquece o sexto
 * item não vai reler o documento justamente na hora em que esqueceu. Foi o que
 * aconteceu no SINDSERM — o logo dos PDFs, a porta do CORS, o nome do cookie e
 * o banco ficaram para trás, um de cada vez, e cada um custou uma investigação.
 *
 * O que este script NÃO faz, de propósito:
 *  · não cria o banco (ele confere se o nome está livre e diz o comando);
 *  · não inventa CNPJ, endereço nem cor — pede, e recusa seguir sem.
 *
 * A rede de segurança final é `tenants.conformidade.spec.ts`: se algum ponto
 * ficar pela metade, o teste reprova. O script evita o trabalho; o teste evita
 * o esquecimento.
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');

const RAIZ = path.resolve(__dirname, '..');

/**
 * DOIS MODOS.
 *
 *   npm run novo-cliente                    pergunta uma coisa de cada vez
 *   npm run novo-cliente -- respostas.json  lê tudo de um arquivo
 *
 * O modo por arquivo não é conveniência: é o que torna o cadastro repetível e
 * revisável — as respostas ficam num arquivo que se lê antes de rodar, em vez
 * de vinte respostas digitadas que ninguém mais consegue conferir. É também o
 * único jeito de testar o gerador, porque `readline` com entrada canalizada
 * perde as linhas que chegam antes de a pergunta ser feita.
 */
const ARQUIVO_RESPOSTAS = process.argv.slice(2).find((a) => a.endsWith('.json'));
const RESPOSTAS = ARQUIVO_RESPOSTAS
  ? JSON.parse(fs.readFileSync(path.resolve(ARQUIVO_RESPOSTAS), 'utf8'))
  : null;

const rl = RESPOSTAS
  ? null
  : readline.createInterface({ input: process.stdin, output: process.stdout });
const perguntar = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));

/**
 * Pergunta até vir resposta; `obrigatorio: false` aceita vazio.
 *
 * `chave` liga o campo à propriedade do arquivo de respostas. Sem ela, o campo
 * só existe no modo interativo.
 */
async function campo(rotulo, { obrigatorio = true, padrao = '', valida, chave } = {}) {
  if (RESPOSTAS) {
    const bruto = chave && RESPOSTAS[chave] !== undefined ? String(RESPOSTAS[chave]) : padrao;
    if (!bruto && obrigatorio) throw new Error(`Falta "${chave}" no arquivo de respostas (${rotulo}).`);
    const erro = bruto ? valida?.(bruto) : null;
    if (erro) throw new Error(`"${chave}": ${erro}`);
    return bruto;
  }
  for (;;) {
    const dica = padrao ? ` [${padrao}]` : '';
    const resposta = (await perguntar(`  ${rotulo}${dica}: `)) || padrao;
    if (!resposta && !obrigatorio) return '';
    if (!resposta) {
      console.log('    (obrigatório)');
      continue;
    }
    const erro = valida?.(resposta);
    if (erro) {
      console.log(`    ${erro}`);
      continue;
    }
    return resposta;
  }
}

const MODULOS = [
  'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados', 'colaboradores',
  'escalas', 'eventos', 'colonia', 'acessos', 'cobrancas', 'empresas',
  'auditoria', 'usuarios',
];

/** Os que quase todo sindicato usa — o resto se pergunta um a um. */
const MODULOS_PADRAO = ['dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
  'colaboradores', 'escalas', 'eventos', 'auditoria', 'usuarios'];

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n  CLIENTE NOVO\n  ' + '-'.repeat(52) + '\n');

  const id = await campo('Identificador (minúsculas, sem espaço; ex.: sindserm)', {
    chave: 'id',
    valida: (v) => {
      if (!/^[a-z][a-z0-9-]*$/.test(v)) return 'Use apenas minúsculas, números e hífen.';
      if (fs.existsSync(path.join(RAIZ, 'apps/api/src/tenant/tenants', `${v}.ts`))) {
        return 'Já existe um cliente com este identificador.';
      }
      return null;
    },
  });

  const sigla = (await campo('Sigla (ex.: SINDSERM)', { chave: 'sigla' })).toUpperCase();
  const nome = (await campo('Razão social completa', { chave: 'nome' })).toUpperCase();
  const nomeCurto = await campo('Nome curto (rodapés e assinaturas)', { chave: 'nomeCurto' });
  const cnpj = await campo('CNPJ', { chave: 'cnpj' });
  const registro = await campo('Registro sindical (código da entidade)', { chave: 'registroSindical', obrigatorio: false });

  console.log('\n  Endereço');
  const logradouro = (await campo('Logradouro e número', { chave: 'logradouro' })).toUpperCase();
  const bairro = (await campo('Bairro', { chave: 'bairro' })).toUpperCase();
  const cidade = (await campo('Cidade', { chave: 'cidade' })).toUpperCase();
  const uf = (await campo('UF', { chave: 'uf', valida: (v) => (/^[A-Za-z]{2}$/.test(v) ? null : 'Duas letras.') })).toUpperCase();
  const cep = await campo('CEP', { chave: 'cep' });

  console.log('\n  Contato (sai no rodapé dos documentos)');
  const telefone = await campo('Telefone(s)', { chave: 'telefone', obrigatorio: false });
  const email = await campo('E-mail', { chave: 'email', obrigatorio: false });

  console.log('\n  Vocabulário — como o sindicato chama quem representa');
  const filiado = (await campo('No singular', { chave: 'filiado', padrao: 'filiado' })).toLowerCase();
  const filiados = (await campo('No plural', { chave: 'filiados', padrao: 'filiados' })).toLowerCase();

  console.log('\n  Contribuição');
  const contribuicao = await campo('Como é cobrada (sai no termo)', { chave: 'contribuicao', obrigatorio: false });
  const temConta = (await campo('Tem conta bancária no termo? (s/N)', { chave: 'temConta', obrigatorio: false })).toLowerCase() === 's';
  let bancario = null;
  if (temConta) {
    bancario = {
      banco: await campo('Banco', { chave: 'banco_nome' }),
      agencia: await campo('Agência', { chave: 'agencia' }),
      operacao: await campo('Operação', { chave: 'operacao', obrigatorio: false }),
      conta: await campo('Conta', { chave: 'conta' }),
    };
  }

  console.log('\n  Cor institucional — os dez tons saem dela, e podem ser');
  console.log('  trocados depois pela própria tela (Configurações).');
  const cor = await campo('Cor em hexadecimal (ex.: #0F4C81)', {
    chave: 'cor',
    valida: (v) => (/^#?[0-9a-fA-F]{6}$/.test(v) ? null : 'Use #RRGGBB.'),
  });

  console.log('\n  Módulos além do padrão (responda s/n)');
  const modulos = [...MODULOS_PADRAO];
  for (const m of MODULOS.filter((x) => !MODULOS_PADRAO.includes(x))) {
    const sim = (await campo(`${m}?`, { chave: `modulo_${m}`, obrigatorio: false })).toLowerCase().startsWith('s');
    if (sim) modulos.push(m);
  }

  console.log('\n  Campos do cadastro que este sindicato NÃO usa');
  console.log('  (ex.: formacao,numeroCoren — a escala e o registro de enfermagem)');
  const ocultosBruto = await campo('Separados por vírgula', { chave: 'camposOcultos', obrigatorio: false });
  const camposOcultos = ocultosBruto ? ocultosBruto.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const banco = await campo('\n  Nome do banco de dados em desenvolvimento', {
    chave: 'banco',
    padrao: `${id}_sindical`,
    valida: (v) => (/^[a-z][a-z0-9_]*$/.test(v) ? null : 'Minúsculas, números e underscore.'),
  });

  rl?.close();

  // -------------------------------------------------------------------------
  const portas = proximasPortas();
  const paleta = derivar(cor.startsWith('#') ? cor : `#${cor}`);

  escreverConfigApi({ id, sigla, nome, nomeCurto, cnpj, registro, logradouro, bairro,
    cidade, uf, cep, telefone, email, filiado, filiados, contribuicao, bancario,
    camposOcultos, modulos });
  escreverConfigWeb({ id, sigla, nome, nomeCurto, filiado, filiados, camposOcultos, modulos, paleta });
  registrar(id);
  acrescentarPortas(id, portas);
  acrescentarCi(id, paleta);
  escreverEnvs(id, banco, portas);

  console.log(`\n  ${'-'.repeat(52)}`);
  console.log(`  ${sigla} cadastrado.\n`);
  console.log('  FALTA VOCÊ FAZER:');
  console.log(`   1. criar o banco:  CREATE DATABASE "${banco}";`);
  console.log('      (confira antes que o nome está livre — há outros sistemas');
  console.log('       no mesmo Postgres, e apontar para o banco de outro faz a');
  console.log('       API subir sem a tabela `users`)');
  console.log(`   2. migrar:  cd apps/api && DATABASE_URL=… npx prisma migrate deploy`);
  console.log(`   3. subir:   npm run dev:${id}`);
  console.log(`   4. logos:   apps/web/public/${id}-{horizontal,vertical}-{cor,branco}.png`);
  console.log(`               apps/api/assets/${id}-horizontal-branco.png  (PDFs)`);
  console.log(`               — ou envie pela tela, em Configurações › Identidade visual`);
  console.log('\n  Confira com:  npm test -w @senatepi/api\n');
}

// --------------------------------------------------------------------------- geração

function derivar(base) {
  // Espelha `apps/web/src/lib/paleta.ts` — o algoritmo de verdade, com os
  // testes, mora lá. Aqui só se gera o valor inicial do arquivo.
  const n = base.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb); const min = Math.min(...rgb);
  const l0 = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rgb[0]) h = ((rgb[1] - rgb[2]) / d + (rgb[1] < rgb[2] ? 6 : 0)) / 6;
    else if (max === rgb[1]) h = ((rgb[2] - rgb[0]) / d + 2) / 6;
    else h = ((rgb[0] - rgb[1]) / d + 4) / 6;
  }
  const DEG = [[50, 0.965, 0.55], [100, 0.925, 0.65], [200, 0.85, 0.75], [300, 0.75, 0.85],
    [400, 0.64, 0.95], [500, 0.54, 1], [600, 0.45, 1], [700, 0.38, 1],
    [800, 0.31, 1], [900, 0.24, 0.95]];
  const hex = (H, S, L) => {
    if (S === 0) { const v = Math.round(L * 255); return '#' + [v, v, v].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); }
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S; const p = 2 * L - q;
    const ch = (t) => { let u = t; if (u < 0) u += 1; if (u > 1) u -= 1;
      if (u < 1 / 6) return p + (q - p) * 6 * u;
      if (u < 1 / 2) return q;
      if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
      return p; };
    return '#' + [ch(H + 1 / 3), ch(H), ch(H - 1 / 3)]
      .map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const contraste = (c) => {
    const k = c.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(k.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 1.05 / (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] + 0.05);
  };
  const out = {};
  for (const [tom, luz, fator] of DEG) {
    let L = luz; let c = hex(h, s * fator, L);
    if ([600, 700, 800, 900].includes(tom)) {
      let voltas = 0;
      while (contraste(c) < 4.5 && L > 0.05 && voltas < 40) { L -= 0.02; c = hex(h, s * fator, L); voltas += 1; }
    }
    out[tom] = c;
  }
  return out;
}

function proximasPortas() {
  const dev = fs.readFileSync(path.join(RAIZ, 'scripts/dev.js'), 'utf8');
  const usadas = [...dev.matchAll(/api:\s*(\d+),\s*web:\s*(\d+)/g)]
    .flatMap((m) => [Number(m[1]), Number(m[2])]);
  const apis = usadas.filter((p) => p >= 3300 && p < 3400);
  const webs = usadas.filter((p) => p >= 3000 && p < 3100);
  return { api: Math.max(3332, ...apis) + 1, web: Math.max(2999, ...webs) + 1 };
}

const escapar = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function escreverConfigApi(d) {
  const arquivo = path.join(RAIZ, 'apps/api/src/tenant/tenants', `${d.id}.ts`);
  const conteudo = `import { TenantConfig } from '../tenant.types';

/** ${d.sigla} — ${d.nomeCurto}. */
export const ${nomeVar(d.id)}: TenantConfig = {
  id: '${escapar(d.id)}',
  sigla: '${escapar(d.sigla)}',
  nome: '${escapar(d.nome)}',
  nomeCurto: '${escapar(d.nomeCurto)}',
  cnpj: '${escapar(d.cnpj)}',
  registroSindical: ${d.registro ? `{ codigoEntidade: '${escapar(d.registro)}' }` : '{}'},
  endereco: {
    logradouro: '${escapar(d.logradouro)}',
    bairro: '${escapar(d.bairro)}',
    cidade: '${escapar(d.cidade)}',
    uf: '${escapar(d.uf)}',
    cep: '${escapar(d.cep)}',
  },
  contato: {${d.telefone ? `\n    telefone: '${escapar(d.telefone)}',` : ''}${d.email ? `\n    email: '${escapar(d.email)}',` : ''}${d.telefone || d.email ? '\n  ' : ''}},
${d.bancario ? `  bancario: { banco: '${escapar(d.bancario.banco)}', agencia: '${escapar(d.bancario.agencia)}',${d.bancario.operacao ? ` operacao: '${escapar(d.bancario.operacao)}',` : ''} conta: '${escapar(d.bancario.conta)}' },\n` : ''}  vocabulario: { filiado: '${escapar(d.filiado)}', filiados: '${escapar(d.filiados)}', matricula: 'matrícula' },
${d.contribuicao ? `  contribuicao: { descricao: '${escapar(d.contribuicao)}' },\n` : ''}  camposOcultos: [${d.camposOcultos.map((c) => `'${escapar(c)}'`).join(', ')}],
  modulos: [
    ${d.modulos.map((m) => `'${m}'`).join(', ')},
  ],
};
`;
  fs.writeFileSync(arquivo, conteudo, 'utf8');
  console.log('  escrito:', path.relative(RAIZ, arquivo));
}

function escreverConfigWeb(d) {
  const arquivo = path.join(RAIZ, 'apps/web/src/tenant/tenants', `${d.id}.ts`);
  const tons = Object.entries(d.paleta)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([tom, hex]) => `  ${tom}: '${hex}',`).join('\n');
  const conteudo = `import type { PaletaMarca, TenantConfigWeb } from '../tenant.types';

/**
 * Paleta do ${d.sigla}, DERIVADA da cor institucional informada no cadastro.
 *
 * Os dez degraus são obrigatórios: o Tailwind não emite classe para tom
 * inexistente. Os tons de fundo sólido já saem com contraste AA conferido
 * contra texto branco — e podem ser trocados pela tela, em Configurações ›
 * Identidade visual, sem passar por aqui.
 */
const PALETA: PaletaMarca = {
${tons}
};

/** ${d.sigla} — ${d.nomeCurto}. */
export const ${nomeVar(d.id)}: TenantConfigWeb = {
  id: '${escapar(d.id)}',
  sigla: '${escapar(d.sigla)}',
  nome: '${escapar(d.nome)}',
  descricao: '${escapar(d.nomeCurto)}',
  paleta: PALETA,
  vocabulario: { filiado: '${escapar(d.filiado)}', filiados: '${escapar(d.filiados)}', matricula: 'matrícula' },
  modulos: [
    ${d.modulos.map((m) => `'${m}'`).join(', ')},
  ],
  camposOcultos: [${d.camposOcultos.map((c) => `'${escapar(c)}'`).join(', ')}],
};
`;
  fs.writeFileSync(arquivo, conteudo, 'utf8');
  console.log('  escrito:', path.relative(RAIZ, arquivo));
}

const nomeVar = (id) => id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/**
 * Descobre a quebra de linha do arquivo antes de mexer nele.
 *
 * No Windows o git entrega os arquivos com CRLF, e uma expressão que procura
 * `{\n` não casa com `{\r\n`. O gerador rodou "com sucesso" e não registrou
 * nada — só o teste de conformidade mostrou. É exatamente o tipo de falha
 * silenciosa que este script existe para evitar, e ele caiu nela primeiro.
 */
function quebra(texto) {
  return texto.includes('\r\n') ? '\r\n' : '\n';
}

function registrar(id) {
  for (const [rel, imp] of [
    ['apps/api/src/tenant/tenant.config.ts', `import { ${nomeVar(id)} } from './tenants/${id}';`],
    ['apps/web/src/tenant.config.ts', `import { ${nomeVar(id)} } from './tenant/tenants/${id}';`],
  ]) {
    const p = path.join(RAIZ, rel);
    let s = fs.readFileSync(p, 'utf8');
    if (s.includes(imp)) continue;
    const eol = quebra(s);

    const linhas = s.split(/\r?\n/);
    const ultimo = linhas.reduce((acc, l, i) => (l.startsWith('import ') ? i : acc), 0);
    linhas.splice(ultimo + 1, 0, imp);
    s = linhas.join(eol);

    const antes = s;
    s = s.replace(/(const TENANTS[^{]*\{\r?\n)/, `$1  ${nomeVar(id)},${eol}`);
    if (s === antes) throw new Error(`Não encontrei o registro TENANTS em ${rel}.`);

    fs.writeFileSync(p, s, 'utf8');
    console.log('  registrado em:', rel);
  }
}

function acrescentarPortas(id, portas) {
  const p = path.join(RAIZ, 'scripts/dev.js');
  const original = fs.readFileSync(p, 'utf8');
  const eol = quebra(original);
  const s = original.replace(
    /(const PORTAS = \{\r?\n)/,
    `$1  ${id}: { api: ${portas.api}, web: ${portas.web} },${eol}`,
  );
  if (s === original) throw new Error('Não encontrei o mapa PORTAS em scripts/dev.js.');
  fs.writeFileSync(p, s, 'utf8');
  console.log(`  portas: API ${portas.api} · web ${portas.web}`);

  const pkg = path.join(RAIZ, 'package.json');
  const json = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  json.scripts[`dev:${id}`] = `node scripts/dev.js ${id}`;
  fs.writeFileSync(pkg, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(`  script: npm run dev:${id}`);
}

function acrescentarCi(id, paleta) {
  const p = path.join(RAIZ, '.github/workflows/ci.yml');
  const original = fs.readFileSync(p, 'utf8');
  const eol = quebra(original);
  let s = original;

  s = s.replace(/(tenant:\s*\[)([^\]]+)(\])/, (_, a, lista, c) => `${a}${lista.trim()}, ${id}${c}`);
  if (s === original) throw new Error('Não encontrei a matriz de tenants no ci.yml.');

  /**
   * A asserção da marca precisa dos valores do cliente novo, senão ela seria
   * pulada em silêncio — e a CI passaria a construir o cliente sem conferir se
   * a cor compilada é a dele.
   */
  const hex = paleta['800'].replace('#', '');
  const canais = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
  const antesEsac = s;
  s = s.replace(/(\r?\n\s*esac)/, `${eol}            ${id}) HEX="${hex}"; CANAIS="${canais}" ;;$1`);
  if (s === antesEsac) throw new Error('Não encontrei o bloco de cores no ci.yml.');

  fs.writeFileSync(p, s, 'utf8');
  console.log(`  CI: na matriz, com a cor #${hex} conferida`);
}

function escreverEnvs(id, banco, portas) {
  const segredo = () => crypto.randomBytes(32).toString('hex');
  const api = path.join(RAIZ, 'apps/api', `.env.${id}`);
  fs.writeFileSync(api, `# ${id.toUpperCase()} em desenvolvimento — SÓ o que muda em relação ao .env comum.
# NÃO vai para o git.

# Banco PRÓPRIO. CONFIRA que o nome está livre: há outros sistemas no mesmo
# Postgres, e apontar para o banco de outro faz a API subir sem a tabela users.
DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/${banco}?schema=public"

API_PORT=${portas.api}
CORS_ORIGINS="http://localhost:${portas.web}"
SEED_ADMIN_EMAIL=admin@${id}.org.br

# Acervo próprio: sem isto os clientes gravam na mesma pasta e a URL assinada
# de um aponta para a API do outro.
STORAGE_LOCAL_DIR=./uploads-${id}
STORAGE_PUBLIC_URL=http://localhost:${portas.api}

# Segredos PRÓPRIOS. Um segredo compartilhado faz um token de um sindicato
# valer no outro. (A claim \`tenant\` no JWT é a segunda barreira.)
JWT_ACCESS_SECRET=${segredo()}
JWT_REFRESH_SECRET=${segredo()}
# Trocar este valor depois invalida TODAS as carteirinhas já emitidas.
QR_SIGNING_SECRET=${segredo()}
`, 'utf8');
  console.log('  escrito:', path.relative(RAIZ, api), '(ajuste a SENHA do banco)');

  const web = path.join(RAIZ, 'apps/web', `.env.${id}`);
  fs.writeFileSync(web, `# ${id.toUpperCase()} em desenvolvimento. NÃO vai para o git.
NEXT_PUBLIC_API_URL=http://localhost:${portas.api}/api
NEXT_PUBLIC_APP_NAME=${id.toUpperCase()}
`, 'utf8');
  console.log('  escrito:', path.relative(RAIZ, web));
}

main().catch((e) => { rl?.close(); console.error('\n  ERRO:', e.message); process.exit(1); });
