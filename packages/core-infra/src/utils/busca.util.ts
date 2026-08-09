/**
 * Normalização de texto para busca.
 *
 * ESPELHO EXATO de `senatepi_normalizar_busca()` no banco (migração
 * 20260802210000_busca_normalizada). As duas pontas PRECISAM produzir o mesmo
 * resultado: a coluna `busca_normalizada` é gravada pelo gatilho usando a
 * versão SQL, e a consulta compara com o que sai daqui. Divergir faz a busca
 * simplesmente não encontrar — sem erro nenhum, o que é pior.
 *
 * Se um dia mexer numa, mexa na outra. O teste em busca.util.spec.ts compara
 * as duas implementações justamente para impedir que se separem em silêncio.
 */
export function normalizarBusca(texto?: string | null): string {
  return (
    (texto ?? '')
      // NFD separa a letra do acento: "á" vira "a" + marca combinante.
      .normalize('NFD')
      // \p{Diacritic} apaga essas marcas. É escrito assim, e não como uma
      // faixa ̀-ͯ, porque a faixa exige combinantes literais no
      // código-fonte — caracteres invisíveis que qualquer editor ou script de
      // migração pode corromper sem ninguém perceber.
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      // Pontuação vira ESPAÇO, não sumiço: "SEN-2026-000129" produz as
      // palavras "sen", "2026" e "000129", e cada uma encontra a pessoa
      // sozinha.
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/**
 * Quebra o que a pessoa digitou nas palavras a procurar.
 *
 * Cada palavra é exigida separadamente (E, não OU), o que faz "mirela jesus"
 * encontrar MIRELA CARVALHO DE JESUS — antes dava zero, porque a busca
 * procurava a sequência literal "mirela jesus".
 *
 * Um CPF com máscara se resolve sozinho: "005.636.633-75" vira as palavras
 * "005", "636", "633" e "75", e todas estão contidas na sequência de dígitos
 * guardada na coluna normalizada.
 */
export function termosDeBusca(texto?: string | null): string[] {
  const normalizado = normalizarBusca(texto);
  return normalizado ? normalizado.split(' ').filter(Boolean) : [];
}
