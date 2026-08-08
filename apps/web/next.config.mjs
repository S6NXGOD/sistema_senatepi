/**
 * CADA SINDICATO TEM O SEU DIRETÓRIO DE BUILD.
 *
 * O Next guarda build e cache em `.next`. Com um diretório só, dois clientes
 * na mesma máquina brigam por ele de dois jeitos, e os dois já aconteceram:
 *
 *  1. Rodar `npm run dev` (SENATEPI) e `npm run dev:sindserm` ao mesmo tempo
 *     faz os dois escreverem no mesmo lugar e um corromper os chunks do outro.
 *  2. Construir para um cliente e depois para o outro reaproveitava o CSS do
 *     anterior — o SINDSERM saía VERDE, porque o Tailwind compila a paleta
 *     dentro do CSS e o cache a devolvia intacta.
 *
 * `.next-senatepi` e `.next-sindserm` resolvem os dois de uma vez: são caches
 * separados, então não há o que reaproveitar errado nem o que corromper.
 *
 * Sem a variável (um `next build` avulso), volta a ser `.next` — nada quebra
 * para quem não usa o mecanismo.
 */
const tenant = process.env.NEXT_PUBLIC_TENANT?.trim().toLowerCase();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: tenant ? `.next-${tenant}` : '.next',
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
