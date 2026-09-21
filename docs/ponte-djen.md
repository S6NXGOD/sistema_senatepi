# A ponte do DJEN — o repassador brasileiro

**Para que serve.** O CDN do CNJ recusa as consultas ao DJEN por **origem da
requisição**: a mesma URL devolve `200` quando chamada do Brasil e `403` quando
chamada do servidor de produção (Railway, fora do país). Não é limite de uso,
não é cabeçalho, não é ritmo — nenhum ajuste no código contorna. A saída é
passar por uma máquina brasileira.

> Medido lado a lado, com a mesma URL: do Brasil `200`, `x-amz-cf-pop: GIG52`
> (Rio); da produção `403`, `x-amz-cf-pop: SFO53` (San Francisco).

**O que já existe.** Uma VPS Hostinger em Campinas — `179.199.142.206`,
Ubuntu 26.04, Nginx 1.28.3 — rodando um `proxy_pass` para
`https://comunicaapi.pje.jus.br`. A API aponta para ela pela variável
`DJEN_BASE_URL`.

---

## Como saber se ela caiu

Três comandos, nesta ordem. Eles separam "o tribunal caiu" de "nós não
chegamos lá":

```bash
# 1. O CNJ está no ar? (rode de uma máquina NO BRASIL)
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab=9226&ufOab=PI&itensPorPagina=1"
# esperado: 200

# 2. A ponte está no ar e configurada?
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://179.199.142.206/api/v1/comunicacao?numeroOab=9226&ufOab=PI&itensPorPagina=1" -k
# esperado: 200.  404 = o Nginx está rodando SEM a configuração do repassador.
# sem resposta = a VPS ou o Nginx caíram.

# 3. O que a produção registrou (a linha traz o motivo desde 21/09/2026)
#    Tabela logs_sincronizacao_datajud, fonte='DJEN', a linha de resumo do dia.
```

**Incidente de 20–21/09/2026:** o passo 1 deu `200` e o passo 2 deu **`404`** —
o Nginx respondendo e sem nenhum site configurado. As 165 consultas da varredura
falharam com "bloqueio de origem", porque sem a ponte a API sai pelo IP do
Railway. Nenhuma publicação entrou desde 19/09.

---

## A configuração do repassador

`/etc/nginx/sites-available/djen` — e um link em `sites-enabled`:

```nginx
# Repassador do DJEN: recebe do Railway e sai daqui, com IP brasileiro.
#
# O CNJ bloqueia por origem, então a única coisa que esta máquina faz é estar
# no Brasil. Ela não guarda nada, não interpreta nada e não tem estado.
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Um segredo simples no cabeçalho: sem ele, o repassador é um proxy aberto
    # para qualquer um consumir a cota do CNJ em nome do sindicato.
    set $autorizado 0;
    if ($http_x_ponte_chave = "TROQUE-POR-UM-SEGREDO-LONGO") { set $autorizado 1; }
    if ($autorizado = 0) { return 403; }

    location /api/ {
        proxy_pass https://comunicaapi.pje.jus.br/api/;
        proxy_ssl_server_name on;
        proxy_set_header Host comunicaapi.pje.jus.br;
        # NÃO repassa X-Forwarded-For: o CDN olharia o IP de origem original.
        proxy_set_header X-Forwarded-For "";
        proxy_set_header X-Real-IP "";

        # A varredura inteira leva minutos; uma consulta, segundos.
        proxy_connect_timeout 20s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Só o caminho da API. Qualquer outra coisa é ruído (e varredura de robô).
    location / { return 404; }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/djen /etc/nginx/sites-enabled/djen
sudo nginx -t && sudo systemctl reload nginx
```

E no Railway, no serviço da **API**:

```
DJEN_BASE_URL=http://179.199.142.206/api/v1
DJEN_PONTE_CHAVE=<o mesmo segredo do cabeçalho>
```

> O código lê `DJEN_BASE_URL` com default literal
> (`https://comunicaapi.pje.jus.br/api/v1`) — por isso, quando a variável some,
> nada quebra na subida: a API simplesmente volta a falar direto com o CNJ e
> toma 403 em tudo. É o modo de falhar mais silencioso possível, e é por isso
> que o passo 2 acima existe.

---

## Por que não vale mexer no código

- **Trocar cabeçalhos, User-Agent ou ritmo:** não muda nada. O bloqueio é por
  IP de origem no CDN.
- **Usar o DataJud no lugar:** é outra API, com outro conteúdo. O DataJud
  entrega o ANDAMENTO (e com mediana de 62 dias de atraso neste acervo); o DJEN
  entrega o TEOR do ato, em D+0. Um não substitui o outro.
- **Hospedar a API no Brasil:** resolveria, e é a solução definitiva — mas é
  mudança de infraestrutura inteira, não de integração.

## Sinais de que caiu, na tela

Desde 21/09/2026 o sistema diz a verdade sobre isso sozinho:

- a faixa do painel: *"Algumas publicações podem não ter chegado. O Diário de
  Justiça recusou N das M leituras registradas hoje."*
- o botão **Buscar agora**: *"O Diário não respondeu a nenhuma das N consultas.
  Nada foi buscado."* — e **não** mais "Busca concluída, nada novo";
- a linha do log traz o motivo dominante das falhas.
