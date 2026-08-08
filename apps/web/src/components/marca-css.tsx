import { tenant } from '@/tenant.config';
import { hexParaHslCss, paletaParaCanaisCss } from '@/lib/paleta';
import { CHAVE_MARCA } from '@/lib/identidade-visual';

/**
 * AS CORES DA MARCA, COMO VARIÁVEIS CSS.
 *
 * O Tailwind não guarda mais o hexadecimal: `bg-brand-800` virou
 * `rgb(var(--brand-800) / <alpha-value>)`. Quem dá valor a essas variáveis é
 * este componente — e é isso que permite trocar a cor do sindicato pela tela,
 * sem deploy.
 *
 * SÃO DUAS CAMADAS, e a ordem importa:
 *
 *  1. O `<style>` abaixo, renderizado no SERVIDOR, com a paleta compilada do
 *     `tenant.config`. É o que pinta o primeiro quadro — sem ele haveria um
 *     lampejo sem cor nenhuma em toda navegação.
 *  2. O `<script>` logo depois, que aplica a cor salva pela instalação antes
 *     do primeiro pixel. Sem ele, um sindicato que trocou a cor pela tela veria
 *     a cor antiga piscar a cada carregamento — o mesmo truque que os seletores
 *     de tema claro/escuro usam para não piscar branco.
 *
 * O `IdentidadeProvider` cuida da terceira camada: buscar a cor no servidor e
 * guardar aqui para a próxima visita.
 */
export function MarcaCss() {
  const canais = paletaParaCanaisCss(tenant.paleta);

  /**
   * `--primary` e `--ring` são o contrato do shadcn (`hsl(var(--primary))`) e
   * estavam escritos à mão no `globals.css` como o verde do SENATEPI — em duas
   * versões, uma para cada tema. O claro usa o tom 800; o escuro, o 400, que é
   * como o arquivo original fazia: sobre fundo escuro a cor institucional
   * cheia fica pesada demais.
   */
  const hsl = (tom: number) => hexParaHslCss(tenant.paleta[tom] ?? '') ?? '';
  const claro = [
    ...Object.entries(canais).map(([nome, valor]) => `${nome}:${valor}`),
    `--primary:${hsl(800)}`,
    `--ring:${hsl(600)}`,
  ]
    .filter((d) => !d.endsWith(':'))
    .join(';');
  const escuro = [`--primary:${hsl(400)}`, `--ring:${hsl(400)}`]
    .filter((d) => !d.endsWith(':'))
    .join(';');

  return (
    <>
      <style
        id="marca-padrao"
        // Só nomes de variável e números gerados aqui — nada vindo de fora.
        dangerouslySetInnerHTML={{ __html: `:root{${claro}}.dark{${escuro}}` }}
      />
      <script
        // A chave tem o sindicato no prefixo (ver `lib/armazenamento.ts`) e
        // precisa ser a MESMA de `CHAVE_MARCA` — este script roda antes do
        // bundle, então não dá para importar a constante; ela é interpolada.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var c=localStorage.getItem(${JSON.stringify(CHAVE_MARCA)});if(!c)return;var o=JSON.parse(c);var e=document.documentElement;for(var k in o){if(/^--brand-\\d+$|^--primary$|^--ring$/.test(k))e.style.setProperty(k,o[k]);}}catch(e){}})();`,
        }}
      />
    </>
  );
}
