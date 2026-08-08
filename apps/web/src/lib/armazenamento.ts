import { tenant } from '@/tenant.config';

/**
 * CHAVE DE ARMAZENAMENTO DO NAVEGADOR, com o sindicato no prefixo.
 *
 * As chaves eram literais: `'senatepi:dossie-datajud'`,
 * `'senatepi:instancias-reavaliadas'`, `'senatepi:sala:<id>'`. Com o nome de um
 * cliente escrito na chave, a instalação do SINDSERM guardava preferências sob
 * o nome do SENATEPI.
 *
 * Hoje isso não CAUSA vazamento — `localStorage` é por origem, e cada sindicato
 * tem o seu domínio (e, em desenvolvimento, a sua porta). É uma precaução de
 * fronteira: o dia em que dois clientes dividirem um domínio, com caminhos
 * diferentes, as chaves literais passariam a se sobrescrever em silêncio, e o
 * sintoma seria a preferência de um aparecendo no outro.
 */
export function chaveLocal(...partes: string[]): string {
  return [tenant.id, ...partes].join(':');
}
