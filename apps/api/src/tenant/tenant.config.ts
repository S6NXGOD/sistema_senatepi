import { ModuloSistema, TenantConfig } from './tenant.types';
import { senatepi } from './tenants/senatepi';
import { sindserm } from './tenants/sindserm';

export type { TenantConfig, ModuloSistema } from './tenant.types';

/**
 * QUEM É O CLIENTE DESTA INSTALAÇÃO.
 *
 * O mesmo código serve a todos os sindicatos. O que muda entre eles — nome,
 * CNPJ, endereço, conta, vocabulário, quais módulos existem, quais campos são
 * pedidos — sai daqui, e não de `if` espalhado pela lógica.
 *
 * NÃO É MULTI-TENANT. Não existe seleção de cliente por requisição: cada
 * instalação é UM cliente, UM banco e UM deploy, e a variável `TENANT` é lida
 * uma vez, no boot. Dois sindicatos são dois serviços apontando para dois
 * bancos, rodando o mesmo build.
 *
 * O QUE MORA AQUI: identidade, dados institucionais que aparecem em documento
 * (PDF, termo, carnê) e a lista de módulos ligados.
 * O QUE NÃO MORA AQUI: segredo (fica em variável de ambiente) e dado que muda
 * sozinho (fica no banco).
 */

const TENANTS: Record<string, TenantConfig> = {
  senatepi,
  sindserm,
};

/**
 * POR QUE ISTO EXPLODE EM VEZ DE ASSUMIR UM PADRÃO.
 *
 * A tentação é cair no SENATEPI quando `TENANT` não vem. Seria o pior erro
 * possível deste desenho: uma API do SINDSERM sem a variável subiria falando o
 * nome do SENATEPI, com a lista de módulos do SENATEPI e os campos do SENATEPI
 * — **por cima do banco do SINDSERM**. Ninguém perceberia até um dado errado
 * já estar gravado.
 *
 * Serviço que não sobe é um problema de 30 segundos, com a causa escrita na
 * primeira linha do log. Cliente trocado em silêncio é um problema de semanas.
 */
function resolverTenant(): TenantConfig {
  const id = (process.env.TENANT ?? '').trim().toLowerCase();
  const conhecidos = Object.keys(TENANTS).join(', ');

  if (!id) {
    throw new Error(
      `A variável de ambiente TENANT não está definida. ` +
        `Sem ela não há como saber de qual sindicato é esta instalação. ` +
        `Valores aceitos: ${conhecidos}.`,
    );
  }
  const escolhido = TENANTS[id];
  if (!escolhido) {
    throw new Error(
      `TENANT="${id}" não corresponde a nenhum cliente. Valores aceitos: ${conhecidos}.`,
    );
  }
  return escolhido;
}

export const tenant: TenantConfig = resolverTenant();

/** Endereço em uma linha — é como ele aparece no rodapé dos PDFs. */
export function enderecoEmLinha(t: TenantConfig = tenant): string {
  const { logradouro, bairro, cidade, uf, cep } = t.endereco;
  return `${logradouro}, ${bairro}, ${cidade}-${uf}, CEP: ${cep}`;
}

/** Conta bancária no formato usado no termo de filiação. */
export function contaEmLinha(t: TenantConfig = tenant): string {
  if (!t.bancario) return '';
  const { banco, agencia, operacao, conta } = t.bancario;
  const op = operacao ? `OP: ${operacao}; ` : '';
  return `AG: ${agencia}; ${op}C/C ${conta} BANCO: ${banco}`;
}

/** O módulo está ligado nesta instalação? */
export function moduloAtivo(modulo: ModuloSistema, t: TenantConfig = tenant): boolean {
  return t.modulos.includes(modulo);
}

/** O campo é pedido e exibido nesta instalação? */
export function campoVisivel(campo: string, t: TenantConfig = tenant): boolean {
  return !(t.camposOcultos ?? []).includes(campo);
}
