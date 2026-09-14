# Mentoria SEEDF Efetivo — captura de leads

Landing page de captura com cupom de 10% + painel de cadastros.

- `/`            página pública (a ficha de inscrição)
- `/api/lead`    recebe o cadastro (POST JSON)
- `/admin`       painel de leads, protegido por senha
- `/admin/leads.csv`  exportação para Excel/Sheets

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

1. O navegador valida os campos e envia para `/api/lead`.
2. O servidor grava no Postgres e responde.
3. A pessoa vê o cupom na tela e um botão que abre o WhatsApp com os dados prontos.

Se o servidor estiver fora do ar, a tela de sucesso e o WhatsApp continuam
funcionando — o lead não se perde, só não entra no banco.
