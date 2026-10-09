# Mentoria SEEDF Efetivo — captura de leads

## Lançamento "Semana Rumo à SEEDF" (sigla `srs`, campanha `seedf2627`)

| Endereço | O que é |
|---|---|
| `/` e `/srs` | link principal: sorteia k01, k02 ou k03 e repassa as UTMs |
| `/srs-k01`, `/srs-k02`, `/srs-k03` | as 3 versões (só muda a headline — em `captura.js`, `VERSOES`) |
| `/srs-obrigado` | confirmação + pesquisa de 10 perguntas (pontos em `views/obrigado.html`) |
| `/srs-bio`, `-stories`, `-mc`, `-dm`, `-yt`, `-live`, `-zap`, `-email` | links curtos (302) com UTM |
| `/srs-stories-0510` (qualquer canal + `-algo`) | mesmo link, com `utm_term=stories-0510` |
| `/dash` | painel da captação (senha `DASH_USER`/`DASH_PASS`) |
| `/mentoria` | a antiga página de venda, preservada |

Cada cadastro e cada resposta vão para a planilha (Apps Script, POST no-cors) **e** para uma
cópia de segurança no Postgres (tabela `capturas`). O `/dash` lê a planilha pelo servidor
usando `APPS_SCRIPT_CHAVE` — a chave nunca vai para o navegador nem para o repositório.
Se a planilha falhar, o dash mostra a cópia de segurança. `/dash?demo=1` mostra dados fictícios.

---


Landing page de captura com cupom de 10%, caminho direto para o checkout e painel de cadastros.

- `/`            página pública (a ficha de inscrição)
- `/api/lead`    recebe o cadastro (POST JSON)
- `/admin`       painel de leads, protegido por senha
- `/admin/leads.csv`  exportação para Excel/Sheets
- `/politica-de-privacidade.html`  política de privacidade e canal para solicitações LGPD

## Publicar no Railway

1. Suba o projeto para um repositório no GitHub.
2. Em railway.app: **New Project → Deploy from GitHub repo** e escolha este repositório.
3. No projeto, clique em **+ New → Database → Add PostgreSQL**.
   O Railway injeta a variável `DATABASE_URL` sozinho — não precisa copiar nada.
4. No serviço da aplicação, aba **Variables**, adicione:
   - `ADMIN_USER` — o usuário do painel (ex.: `jaqueline`)
   - `ADMIN_PASS` — uma senha forte. **Sem ela o /admin fica bloqueado.**
5. Aba **Settings → Networking → Generate Domain** para receber a URL pública.

O Railway detecta o Node sozinho e roda `npm start`. Nada mais a configurar.

## Rodar na sua máquina

```bash
npm install
ADMIN_PASS=teste npm start
# abre em http://localhost:3000  ·  painel em http://localhost:3000/admin
```

Sem `DATABASE_URL`, os cadastros vão para `data/leads.json` — bom para testar,
não use em produção (o disco do Railway é apagado a cada deploy).

## Onde mexer no conteúdo

Tudo na página está em `public/index.html`. No fim do arquivo:

```js
const CONFIG = {
  whatsapp: "5561981993941",
  cupom:    "SEEDF10",
  checkout: "https://go.hotmart.com/I107610411Q?dp=1"
};
```

## O que acontece quando alguém preenche a ficha

1. O navegador valida nome, WhatsApp, área e consentimento e envia para `/api/lead`.
2. O servidor evita duplicidade por WhatsApp e grava no Postgres.
3. A pessoa vê o cupom na tela e um botão que abre o WhatsApp com os dados prontos.

Se o servidor estiver fora do ar, a página não informa falsamente que houve
cadastro: ela mostra o erro e oferece o envio dos dados pelo WhatsApp.

## Rastreamento de conversões

A página já dispara eventos no `dataLayer` e, quando o Meta Pixel estiver
instalado, também pelo `fbq`:

- `lead_form_start`
- `lead_submit`
- `lead_success`
- `lead_error`
- `whatsapp_click`
- `checkout_click`

Os parâmetros UTM são preservados no navegador. Para enviar os eventos às
plataformas, instale o Google Tag Manager/Google Analytics e o Meta Pixel com
os identificadores reais da conta — não use IDs de exemplo.

## Deploy

O serviço do Railway está conectado a este repositório (branch `main`).
Todo `git push` para `main` dispara um deploy automático — não é mais
preciso rodar `railway up` na mão.
