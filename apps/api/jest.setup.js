/**
 * O `tenant.config.ts` explode quando `TENANT` não está definida — de
 * propósito, para uma instalação nunca subir sem saber de qual sindicato é.
 *
 * Teste não tem `.env`, então sem isto o primeiro spec que tocasse em qualquer
 * serviço de domínio quebraria com um erro sobre variável de ambiente, que não
 * tem nada a ver com o que ele está testando. Fixar aqui deixa a suíte
 * determinística e documenta a exigência para quem for escrever o próximo spec.
 */
process.env.TENANT = process.env.TENANT || 'senatepi';
// O teste de conformidade importa a configuração da TELA, que exige a
// variável dela — os dois arquivos explodem sem saber de qual cliente são.
process.env.NEXT_PUBLIC_TENANT = process.env.NEXT_PUBLIC_TENANT || 'senatepi';
