import { PrismaClient, TipoParteExterna } from '@prisma/client';

/**
 * ÓRGÃOS DA PREFEITURA DE TERESINA — carga inicial do SINDSERM.
 *
 *     npm run seed:orgaos:sindserm -w @senatepi/api
 *
 * POR QUE ISTO É DADO, E NÃO CONFIGURAÇÃO. A lista muda: secretaria é criada,
 * fundida e extinta a cada reforma administrativa. Se estivesse no
 * `tenant.config`, corrigir um nome exigiria programador, commit e deploy —
 * como dado, a secretaria do sindicato edita pela tela de Organizações.
 *
 * POR QUE EM `ParteExterna`, e não numa tabela nova de "órgãos". É a MESMA
 * entidade nos dois papéis: a SEMEC que emprega o professor é a SEMEC que
 * figura como ré na ação dele. Uma tabela separada obrigaria a cadastrar duas
 * vezes e a cruzar à mão — e o cruzamento é justamente o que dá valor
 * ("quantos filiados na SEMEC?" × "quantos processos contra a SEMEC?").
 *
 * IDEMPOTENTE: rodar de novo não duplica nem sobrescreve o que a secretaria
 * tiver corrigido. Só cria o que falta.
 */

/** Sigla e razão social, como o servidor e o processo se referem a elas. */
const ORGAOS: Array<{ sigla: string; nome: string }> = [
  { sigla: 'FCMC', nome: 'Fundação Cultural Monsenhor Chaves' },
  { sigla: 'FMS', nome: 'Fundação Municipal de Saúde' },
  { sigla: 'FWF', nome: 'Fundação Wall Ferraz' },
  { sigla: 'IPMT', nome: 'Instituto de Previdência dos Servidores do Município de Teresina' },
  { sigla: 'PGM', nome: 'Procuradoria Geral do Município' },
  { sigla: 'SDR', nome: 'Secretaria Municipal de Desenvolvimento Rural' },

  // As sete regionais da Superintendência de Desenvolvimento Urbano. São
  // unidades distintas para o sindicato: o servidor é lotado em UMA delas, e é
  // por elas que a base se organiza.
  { sigla: 'SAAD Centro', nome: 'Superintendência de Desenvolvimento Urbano — Centro' },
  { sigla: 'SAAD Leste', nome: 'Superintendência de Desenvolvimento Urbano — Leste' },
  { sigla: 'SAAD Norte', nome: 'Superintendência de Desenvolvimento Urbano — Norte' },
  { sigla: 'SAAD Rural', nome: 'Superintendência de Desenvolvimento Urbano — Rural' },
  { sigla: 'SAAD Sudeste', nome: 'Superintendência de Desenvolvimento Urbano — Sudeste' },
  { sigla: 'SAAD Sul 1', nome: 'Superintendência de Desenvolvimento Urbano — Sul 1' },
  { sigla: 'SAAD Sul 2', nome: 'Superintendência de Desenvolvimento Urbano — Sul 2' },

  { sigla: 'SEMA', nome: 'Secretaria Municipal de Administração' },
  { sigla: 'SEMAN', nome: 'Secretaria Municipal de Meio Ambiente' },
  { sigla: 'SEMCASPI', nome: 'Secretaria Municipal de Cidadania, Assistência Social e Políticas Integradas' },
  { sigla: 'SEMCOM', nome: 'Secretaria Municipal de Comunicação Social' },
  { sigla: 'SEMDEC', nome: 'Secretaria Municipal de Desenvolvimento Econômico e Turismo' },
  { sigla: 'SEMDUH', nome: 'Secretaria Municipal de Desenvolvimento Urbano e Habitação' },
  { sigla: 'SEMEC', nome: 'Secretaria Municipal de Educação' },
  { sigla: 'SEMEL', nome: 'Secretaria Municipal de Esportes e Lazer' },
  { sigla: 'SEMF', nome: 'Secretaria Municipal de Finanças' },
  { sigla: 'SEMGOV', nome: 'Secretaria Municipal de Governo' },
  { sigla: 'SEMJUV', nome: 'Secretaria Municipal da Juventude' },
  { sigla: 'SEMPLAN', nome: 'Secretaria Municipal de Planejamento' },
  { sigla: 'SEMUSP', nome: 'Secretaria Municipal de Segurança Pública' },
  { sigla: 'STRANS', nome: 'Superintendência Municipal de Transportes e Trânsito' },
  { sigla: 'SMPM', nome: 'Secretaria Municipal de Políticas Públicas para as Mulheres' },
  { sigla: 'CGM', nome: 'Controladoria Geral do Município' },
  // Aparece também como SEMCP em documentos do município — a secretaria do
  // sindicato corrige pela tela se o uso corrente for o outro.
  { sigla: 'SEMCOP', nome: 'Secretaria Municipal de Concessões e Parcerias' },
  { sigla: 'GABPREF', nome: 'Gabinete do Prefeito' },
];

const prisma = new PrismaClient();

async function main() {
  const tenant = process.env.TENANT;
  if (tenant && tenant !== 'sindserm') {
    throw new Error(
      `Esta carga é dos órgãos da Prefeitura de Teresina, do SINDSERM. ` +
        `TENANT está como "${tenant}" — rodar aqui encheria o cadastro do ` +
        'cliente errado com 31 organizações que não são dele.',
    );
  }

  let criados = 0;
  let existentes = 0;

  for (const { sigla, nome } of ORGAOS) {
    // Procura pela SIGLA e pela razão social: se a secretaria já cadastrou o
    // órgão à mão com um dos dois, não se cria um duplicado.
    const jaExiste = await prisma.parteExterna.findFirst({
      where: { OR: [{ nomeFantasia: sigla }, { nome }] },
      select: { id: true },
    });
    if (jaExiste) {
      existentes += 1;
      continue;
    }

    await prisma.parteExterna.create({
      data: {
        tipo: TipoParteExterna.ORGAO_PUBLICO,
        nome,
        nomeFantasia: sigla,
        cidade: 'Teresina',
        uf: 'PI',
        // Sem CNPJ: cada órgão tem o seu, e inventar um número em cadastro que
        // vai para petição é pior que deixar em branco. A secretaria completa
        // pela tela quando precisar.
      },
    });
    criados += 1;
  }

  console.log(
    `Órgãos da Prefeitura de Teresina: ${criados} criado(s), ${existentes} já existia(m).`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
