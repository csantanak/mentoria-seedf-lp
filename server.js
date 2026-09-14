import express from "express";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

/* ------------------------------------------------------------------ *
 * Armazenamento: Postgres em produção, arquivo JSON para rodar local  *
 * ------------------------------------------------------------------ */
const FILE_DB = path.join(__dirname, "data", "leads.json");
let pool = null;

async function initStore() {
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id         SERIAL PRIMARY KEY,
        nome       TEXT NOT NULL,
        whatsapp   TEXT NOT NULL,
        email      TEXT NOT NULL,
        area       TEXT,
        momento    TEXT,
        cupom      TEXT,
        origem     TEXT,
        criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS leads_criado_em_idx ON leads (criado_em DESC)`);
    console.log("Armazenamento: Postgres");
  } else {
    await fs.mkdir(path.dirname(FILE_DB), { recursive: true });
    try { await fs.access(FILE_DB); } catch { await fs.writeFile(FILE_DB, "[]"); }
    console.log("Armazenamento: arquivo local data/leads.json (sem DATABASE_URL)");
  }
}

async function salvarLead(l) {
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO leads (nome, whatsapp, email, area, momento, cupom, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, criado_em`,
      [l.nome, l.whatsapp, l.email, l.area, l.momento, l.cupom, l.origem]
    );
    return rows[0];
  }
  const todos = JSON.parse(await fs.readFile(FILE_DB, "utf8"));
  const novo = { id: todos.length + 1, ...l, criado_em: new Date().toISOString() };
  todos.push(novo);
  await fs.writeFile(FILE_DB, JSON.stringify(todos, null, 2));
  return novo;
}

async function listarLeads() {
  if (pool) {
    const { rows } = await pool.query(`SELECT * FROM leads ORDER BY criado_em DESC`);
    return rows;
  }
  const todos = JSON.parse(await fs.readFile(FILE_DB, "utf8"));
  return todos.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

/* ------------------------------------------------------------------ *
 * Cadastro                                                            *
 * ------------------------------------------------------------------ */
const janela = new Map();                       // freio simples por IP
function limitado(ip) {
  const agora = Date.now();
  const marcas = (janela.get(ip) || []).filter(t => agora - t < 60_000);
  marcas.push(agora);
  janela.set(ip, marcas);
  if (janela.size > 5000) janela.clear();
  return marcas.length > 6;
}

const texto = (v, max) => String(v ?? "").trim().slice(0, max);

app.post("/api/lead", async (req, res) => {
  try {
    if (limitado(req.ip)) {
      return res.status(429).json({ erro: "Muitas tentativas seguidas. Espere um minuto e envie de novo." });
    }
    const lead = {
      nome: texto(req.body.nome, 120),
      whatsapp: texto(req.body.whatsapp, 32),
      email: texto(req.body.email, 160).toLowerCase(),
      area: texto(req.body.area, 80),
      momento: texto(req.body.momento, 120),
      cupom: texto(req.body.cupom, 40) || "SEEDF10",
      origem: texto(req.body.origem, 200)
    };
    const digitos = lead.whatsapp.replace(/\D/g, "");
    if (lead.nome.split(/\s+/).filter(Boolean).length < 2)
      return res.status(400).json({ erro: "Escreva o nome completo." });
    if (digitos.length < 10)
      return res.status(400).json({ erro: "Informe o WhatsApp com DDD." });
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(lead.email))
      return res.status(400).json({ erro: "Confira o e-mail digitado." });

    const salvo = await salvarLead(lead);
    console.log(`lead #${salvo.id} — ${lead.nome} — ${lead.area}`);
    res.json({ ok: true, id: salvo.id, cupom: lead.cupom });
  } catch (e) {
    console.error("falha ao salvar lead:", e);
    res.status(500).json({ erro: "Não foi possível salvar agora. Envie seus dados pelo WhatsApp." });
  }
});

/* ------------------------------------------------------------------ *
 * Painel                                                              *
 * ------------------------------------------------------------------ */
function protegido(req, res, next) {
  if (!ADMIN_PASS) {
    return res.status(503).send("Defina ADMIN_PASS nas variáveis do Railway para liberar o painel.");
  }
  const header = req.headers.authorization || "";
  const [tipo, valor] = header.split(" ");
  if (tipo === "Basic" && valor) {
    const [u, p] = Buffer.from(valor, "base64").toString("utf8").split(":");
    if (u === ADMIN_USER && p === ADMIN_PASS) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Painel de leads"').status(401).send("Acesso restrito.");
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const dataBR = d => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

app.get("/admin", protegido, async (req, res) => {
  const leads = await listarLeads();
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const deHoje = leads.filter(l => new Date(l.criado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) === hoje).length;
  const porArea = {};
  leads.forEach(l => { porArea[l.area || "—"] = (porArea[l.area || "—"] || 0) + 1; });
  const topArea = Object.entries(porArea).sort((a, b) => b[1] - a[1])[0];

  const linhas = leads.map(l => {
    const zap = String(l.whatsapp).replace(/\D/g, "");
    const wa = zap.length >= 10 ? `https://wa.me/55${zap.slice(-11)}` : null;
    return `<tr>
      <td class="mono dim">${esc(dataBR(l.criado_em))}</td>
      <td><strong>${esc(l.nome)}</strong></td>
      <td class="mono">${wa ? `<a href="${wa}" target="_blank" rel="noopener">${esc(l.whatsapp)}</a>` : esc(l.whatsapp)}</td>
      <td class="mono dim"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>
      <td>${esc(l.area)}</td>
      <td class="dim">${esc(l.momento)}</td>
    </tr>`;
  }).join("");

  res.type("html").send(`<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leads · Mentoria SEEDF</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800;900&family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@400;500;600&display=swap">
<style>
:root{--night:#100A1F;--panel:#1A1029;--line:rgba(255,255,255,.1);--gold:#E8B44A;--white:#fff;--muted:#A99BC4}
*{box-sizing:border-box}
body{margin:0;background:var(--night);color:#EDE7F7;font-family:Manrope,system-ui,sans-serif;font-size:15px}
.wrap{max-width:1240px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:24px}
h1{font-family:Archivo,sans-serif;font-weight:900;font-size:1.9rem;letter-spacing:-.03em;margin:6px 0 0;color:#fff}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin:0}
.btn{font-family:Archivo,sans-serif;font-weight:700;font-size:.86rem;text-decoration:none;color:#1B1005;
  background:linear-gradient(176deg,#FBEFC8,#E8B44A 38%,#B9832C 66%,#F4DCA0);padding:11px 18px;border-radius:8px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px}
.card .k{font-family:"IBM Plex Mono",monospace;font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.card .v{font-family:Archivo,sans-serif;font-weight:900;font-size:1.8rem;color:var(--gold);letter-spacing:-.03em;margin-top:4px;font-variant-numeric:tabular-nums}
.card .s{font-size:.82rem;color:var(--muted);margin-top:2px}
#busca{width:100%;margin-bottom:14px;padding:12px 14px;border-radius:8px;border:1px solid var(--line);
  background:rgba(255,255,255,.04);color:#fff;font-family:Manrope,sans-serif;font-size:.95rem}
#busca:focus{outline:none;border-color:var(--gold)}
.tablebox{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:900px}
th{font-family:"IBM Plex Mono",monospace;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);
  text-align:left;padding:13px 16px;border-bottom:1px solid var(--line);white-space:nowrap;position:sticky;top:0;background:var(--panel)}
td{padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.055);vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(232,180,74,.05)}
.mono{font-family:"IBM Plex Mono",monospace;font-size:.84rem;font-variant-numeric:tabular-nums}
.dim{color:var(--muted)}
a{color:var(--gold)}
.vazio{padding:46px 20px;text-align:center;color:var(--muted)}
@media(max-width:720px){.cards{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<header>
  <div><p class="eyebrow">Mentoria SEEDF Efetivo</p><h1>Cadastros da ficha</h1></div>
  <a class="btn" href="/admin/leads.csv">Baixar CSV</a>
</header>
<div class="cards">
  <div class="card"><div class="k">Total de cadastros</div><div class="v">${leads.length}</div></div>
  <div class="card"><div class="k">Hoje</div><div class="v">${deHoje}</div><div class="s">${esc(hoje)}</div></div>
  <div class="card"><div class="k">Área que mais aparece</div><div class="v">${topArea ? topArea[1] : 0}</div><div class="s">${esc(topArea ? topArea[0] : "sem cadastros ainda")}</div></div>
</div>
<input id="busca" type="search" placeholder="Filtrar por nome, e-mail, área ou momento...">
<div class="tablebox">
${leads.length ? `<table><thead><tr>
  <th>Data</th><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th>Área</th><th>Momento</th>
</tr></thead><tbody id="corpo">${linhas}</tbody></table>`
: `<p class="vazio">Nenhum cadastro ainda. Assim que alguém preencher a ficha, ele aparece aqui.</p>`}
</div>
</div>
<script>
const b=document.getElementById('busca'), c=document.getElementById('corpo');
b&&b.addEventListener('input',()=>{const q=b.value.toLowerCase();
  [...c.rows].forEach(r=>{r.style.display=r.innerText.toLowerCase().includes(q)?'':'none'});});
</script>
</body></html>`);
});

app.get("/admin/leads.csv", protegido, async (req, res) => {
  const leads = await listarLeads();
  const campo = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [
    ["id", "data", "nome", "whatsapp", "email", "area", "momento", "cupom"].join(";"),
    ...leads.map(l => [l.id, dataBR(l.criado_em), l.nome, l.whatsapp, l.email, l.area, l.momento, l.cupom].map(campo).join(";"))
  ];
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="leads-mentoria-seedf-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + linhas.join("\n"));   // BOM para o Excel abrir com acentos
});

app.get("/health", (_, res) => res.json({ ok: true }));

initStore()
  .then(() => app.listen(PORT, () => console.log(`no ar em http://localhost:${PORT}`)))
  .catch(e => { console.error("falha ao iniciar:", e); process.exit(1); });
