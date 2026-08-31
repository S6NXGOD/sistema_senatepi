/**
 * Superfície pública do `@core/infra`.
 *
 * Tudo aqui é agnóstico de domínio: nada sabe o que é filiado, processo ou
 * sindicato. Quem precisar do Prisma ou de uma tabela pertence a um pacote de
 * domínio, não a este.
 *
 * O barril existe para o app importar de UM lugar (`@core/infra`) em vez de
 * conhecer a estrutura interna de pastas do pacote — assim mover um arquivo
 * aqui dentro não quebra nenhum app.
 */

// Armazenamento de arquivos e imagens
export * from './storage/storage.service';
export * from './storage/storage.module';
export * from './storage/image.service';
export * from './storage/avatares.service';
export * from './storage/avatares.interceptor';

// QR Code assinado (carteirinha, crachá, portaria)
export * from './qrcode/qrcode.service';
export * from './qrcode/qrcode.module';

// Utilitários puros
export * from './utils/busca.util';
export * from './utils/cnpj.util';
export * from './utils/datas.util';
export * from './utils/flag.util';
export * from './utils/matricula.util';
export * from './utils/nome-de-arquivo.util';
export * from './utils/pix.util';
export * from './utils/trava-job.util';
