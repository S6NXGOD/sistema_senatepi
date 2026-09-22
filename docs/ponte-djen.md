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

## 1. Diagnóstico — cole no terminal da VPS

Só leitura. Responde **por que parou** e **o que falta**:

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
| `server_name` com um domínio | a API chama por IP e o `Host` não casa → cai no *default server* → 404 | passo 2 (`server_name _`) |
| o `apt` aparece atualizando o nginx perto da data em que parou | o pacote reiniciou o serviço e ele releu só o que estava **em disco** | passo 2 |
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

**20–21/09/2026 — a configuração sumiu do Nginx.** O passo 1 devolveu: CNJ `200`
do Brasil, VPS `404` em `/api/v1/comunicacao` **e na raiz**, Nginx no ar, tráfego
de saída de 0,0 MB no painel da Hostinger. Sem a ponte, a API cai no endereço
público (default literal do código) e sai pelo IP do Railway — 403 em tudo, e
nenhuma publicação entrou desde 19/09. O DataJud seguiu funcionando o tempo
todo: são duas APIs diferentes.
