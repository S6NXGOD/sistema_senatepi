# A ponte do DJEN — o repassador brasileiro

**Para que serve.** O CDN do CNJ recusa as consultas ao DJEN por **origem da
requisição**: a mesma URL devolve `200` quando chamada do Brasil e `403` quando
chamada do servidor de produção (Railway, fora do país). Não é limite de uso,
não é cabeçalho, não é ritmo — nenhum ajuste no código contorna. A saída é
passar por uma máquina brasileira.

> Medido lado a lado, com a mesma URL: do Brasil `200`, `x-amz-cf-pop: GIG52`
> (Rio); da produção `403`, `x-amz-cf-pop: SFO53` (San Francisco).

**O que existe.** Uma VPS Hostinger em Campinas — `179.199.142.206`,
Ubuntu 26.04, Nginx — com um `proxy_pass` para `https://comunicaapi.pje.jus.br`.
A API aponta para ela por `DJEN_BASE_URL`.

---

## 1. Diagnóstico

**Comece pelo Railway, não pelo servidor.** Em 20/09/2026 eu comecei pelo
servidor, testei um caminho que a configuração daquela época não atendia, recebi
o `404` previsto e conclui que a ponte estava desconfigurada — quando o problema
estava na variável. Então, na ordem:

1. **`DJEN_BASE_URL` existe e está correta?** Sem ela a API chama o CNJ direto e
   toma 403 em tudo, em silêncio.
2. **O endereço DELA responde?** Use a URL exata da variável, com o cabeçalho
   exato — nunca um caminho inventado.
3. Só então, na VPS, o bloco abaixo (só leitura):

```bash
echo "== nginx =="; systemctl is-active nginx; nginx -v 2>&1
echo; echo "== sites habilitados =="; ls -l /etc/nginx/sites-enabled/ 2>/dev/null
echo; echo "== sites disponiveis =="; ls -l /etc/nginx/sites-available/ 2>/dev/null
echo; echo "== o que o nginx REALMENTE carregou =="
nginx -T 2>/dev/null | grep -nE "server_name|proxy_pass|listen |location " | head -30
echo; echo "== o apt mexeu no nginx? =="
grep -iE "nginx" /var/log/apt/history.log /var/log/apt/history.log.*.gz 2>/dev/null | tail -10
echo; echo "== a VPS alcanca o CNJ? (tem de ser 200) =="
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=9226&ufOab=PI&itensPorPagina=1"
```

**O que cada resposta quer dizer**

| sintoma | causa | o que fazer |
|---|---|---|
| `sites-enabled` vazio ou sem o arquivo da ponte | a configuração sumiu | passo 2 |
| o arquivo existe mas `nginx -T` não o mostra | falta o link simbólico, ou `nginx -t` falhou e o reload não aconteceu | passo 2 |
| `server_name` com um domínio e a API chama por IP | o `Host` não casa → cai no *default server* | passo 2 (`server_name _`) |
| `location / { return 404; }` e você testou outro caminho | **a ponte está viva** e recusando um caminho que ela não atende — foi o meu erro de 20/09 | teste a URL EXATA da variável |
| o `curl` final **não** dá 200 | aí sim o problema é fora: rede da VPS ou o próprio CNJ | pare e investigue isso antes |

---

## 2. A configuração — cole inteiro

Troque `SEGREDO` por algo longo (o mesmo vai no Railway, no passo 3):

```bash
CHAVE='SEGREDO-LONGO-TROQUE-ISTO'

cat > /etc/nginx/sites-available/djen <<NGINX
# Repassador do DJEN: recebe do Railway e sai daqui, com IP brasileiro.
# A única coisa que esta máquina faz é ESTAR NO BRASIL — não guarda nada,
# não interpreta nada, não tem estado.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    # "_" casa qualquer Host: a API chama pelo IP, e um server_name com
    # domínio faria a requisição cair no default e voltar 404.
    server_name _;

    # Sem a chave, o repassador seria um proxy aberto para a API do CNJ — e a
    # cota é POR IP (20/min): qualquer um poderia gastá-la em nome do sindicato.
    if (\$http_x_ponte_chave != "$CHAVE") { return 403; }

    location /api/ {
        proxy_pass https://comunicaapi.pje.jus.br/api/;
        proxy_ssl_server_name on;
        proxy_set_header Host comunicaapi.pje.jus.br;
        # Não repassa o IP de origem: é justamente ele que o CDN bloqueia.
        proxy_set_header X-Forwarded-For "";
        proxy_set_header X-Real-IP "";
        proxy_set_header X-Ponte-Chave "";
        proxy_connect_timeout 20s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location / { return 404; }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/djen /etc/nginx/sites-enabled/djen
nginx -t && systemctl reload nginx && systemctl enable nginx

echo; echo "== teste local: 403 sem chave, 200 com chave =="
curl -s -o /dev/null -w "sem chave: %{http_code}\n" \
  "http://127.0.0.1/api/v1/comunicacao?numeroOab=9226&ufOab=PI&itensPorPagina=1"
curl -s -o /dev/null -w "com chave: %{http_code}\n" -H "X-Ponte-Chave: $CHAVE" \
  "http://127.0.0.1/api/v1/comunicacao?numeroOab=9226&ufOab=PI&itensPorPagina=1"
```

Esperado: **`sem chave: 403`** e **`com chave: 200`**.

---

## 3. No Railway, serviço da **API**

```
DJEN_BASE_URL=http://179.199.142.206/api/v1
DJEN_PONTE_CHAVE=<o mesmo SEGREDO do passo 2>
```

Salvar reinicia o serviço. Depois, no sistema: **Painel → Buscar agora**. A
resposta certa é *"N publicação(ões) nova(s)"* ou *"Busca concluída: N consultas
responderam"*. Se vier *"O Diário não respondeu a nenhuma das N consultas"*,
volte ao passo 1.

> **`DJEN_PONTE_CHAVE` vazia não envia cabeçalho nenhum** — dá para configurar
> os dois lados em qualquer ordem sem quebrar o que já funciona. E a chave
> **nunca** vai numa chamada direta ao `pje.jus.br`: mandar segredo nosso para
> fora de casa não se faz, mesmo que o destinatário o ignore.

**HTTP e não HTTPS, de propósito:** o que trafega entre o Railway e a VPS é
consulta por OAB e o teor de publicações do Diário Oficial — informação pública,
por definição. Um certificado exigiria domínio e renovação, e dois pontos a mais
para quebrar em silêncio. Se um dia houver domínio (a Hostinger oferece um
grátis no painel), vale o Let's Encrypt.

---

## Por que não vale mexer no código

- **Trocar cabeçalhos, User-Agent ou ritmo:** não muda nada. O bloqueio é por IP
  de origem, no CDN, antes da API.
- **Usar o DataJud no lugar:** é outra API e outro conteúdo. O DataJud entrega o
  ANDAMENTO (com mediana de 62 dias de atraso neste acervo); o DJEN entrega o
  TEOR do ato, em D+0.
- **Hospedar a API no Brasil:** resolveria de vez, e é a solução definitiva —
  mas é mudança de infraestrutura inteira, não de integração.

## Como o sistema avisa que caiu

Desde 21/09/2026 ele diz a verdade sozinho:

- a faixa do painel: *"Algumas publicações podem não ter chegado. O Diário de
  Justiça recusou N das M leituras registradas hoje."*
- o botão **Buscar agora**: *"O Diário não respondeu a nenhuma das N consultas.
  Nada foi buscado."* — e **não** mais "Busca concluída, nada novo";
- a linha de resumo em `logs_sincronizacao_datajud` traz o motivo dominante das
  falhas.

## Histórico

### 20–21/09/2026 — parou, e o meu primeiro diagnóstico estava errado

**O que eu disse:** "a configuração sumiu do Nginx".
**O que era:** a configuração estava lá o tempo todo, intacta desde 03/09.

A ponte antiga usava **caminho secreto** e hostname `nip.io`:

```nginx
server_name 179-199-142-206.nip.io;
location ~ ^/ponte-<hash>/(.*)$ { proxy_pass https://$djen/api/v1/$1$is_args$args; }
location / { return 404; }
```

Eu testei `https://179.199.142.206/api/v1/comunicacao` — um caminho que aquela
configuração **não** atende — e recebi o `404` do `location /`. Li a resposta
CORRETA de uma configuração viva como "não há configuração". Conferido depois:
`https://179-199-142-206.nip.io/ponte-<hash>/comunicacao` devolvia **200** no
mesmo minuto em que eu afirmava que a ponte estava morta.

**A causa real, então, estava do outro lado:** `DJEN_BASE_URL`, no Railway. Sem
ela — ou apontando para um endereço que não responde — a API cai no default
literal do código (`https://comunicaapi.pje.jus.br/api/v1`), sai pelo IP do
Railway e toma 403 em tudo, sem quebrar nada na subida. Não dá para saber o
valor anterior: ele foi substituído antes de eu olhar.

**A lição, e é o motivo de o passo 1 desta página ter mudado de ordem:** quando
uma integração com ponte para de responder, a primeira pergunta é *"o que a
aplicação está chamando?"*, e só depois *"o servidor responde?"*. Testar um
caminho inventado contra um proxy de caminho secreto produz exatamente o
sintoma que se procura — e confirma a hipótese errada.

**O DataJud nunca parou** — rodou em 21/09 às 05:16, 157 processos. São duas
APIs: o DataJud tem chave e aceita qualquer origem; só o DJEN bloqueia por país.

### 22/09/2026 — a ponte nova, com cabeçalho

A configuração deste documento substituiu a antiga: `server_name _` com
`default_server` (a API chama por IP) e segredo no **cabeçalho** em vez de no
caminho. Testado de fora: sem chave `403`, com chave `200` com dados de 21/09.

> **Se a configuração antiga ainda estiver habilitada**, há duas portas abertas
> — e a antiga não exige o cabeçalho, só o caminho. Para fechá-la:
> ```bash
> rm -f /etc/nginx/sites-enabled/ponte-djen && nginx -t && systemctl reload nginx
> ```
