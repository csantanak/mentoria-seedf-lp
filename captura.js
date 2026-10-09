/* ==================================================================== *
 * Captura do lançamento "Semana Rumo à SEEDF" (sigla srs)               *
 *                                                                      *
 *  /srs              divide o tráfego entre k01, k02 e k03 (UTMs vão junto)
 *  /srs-k01..k03     as 3 versões da página (só muda a headline)
 *  /srs-obrigado     confirmação + pesquisa (lead scoring)
 *  /srs-bio, -stories, -mc, -dm, -yt, -live, -zap, -email   links curtos
 *  /srs-stories-0510 (qualquer canal + data) → utm_term=stories-0510
 *  /dash             painel da captação (senha) · /dash/dados lê o Apps Script
 *                                                                      *
 * Variáveis no Railway:                                                *
 *  APPS_SCRIPT_URL   endereço do App da Web (termina em /exec)          *
 *  APPS_SCRIPT_CHAVE a mesma senha da propriedade CHAVE do Apps Script  *
 *  DASH_USER / DASH_PASS  login do /dash (se vazio, usa ADMIN_USER/PASS) *
 * ==================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SIGLA = "srs";
export const CAMPANHA = "seedf2627";

export const VERSOES = {
  k01: {
    headline: "O edital da SEEDF ainda não saiu. <span class=\"foil\">Quem começa agora chega na frente.</span>",
    texto: "O edital da SEEDF ainda não saiu. Quem começa agora chega na frente."
  },
  k02: {
    headline: "7 aulas gratuitas com os <span class=\"foil\">Conhecimentos Pedagógicos que mais derrubam</span> candidatos na SEEDF.",
    texto: "7 aulas gratuitas com os Conhecimentos Pedagógicos que mais derrubam candidatos na SEEDF."
  },
  k03: {
    headline: "Em 7 terças-feiras, domine os <span class=\"foil\">Conhecimentos Pedagógicos</span> que a banca da SEEDF mais cobra.",
    texto: "Em 7 terças-feiras, domine os Conhecimentos Pedagógicos que a banca da SEEDF mais cobra."
  }
};

const CANAIS = {
  bio:     { utm_source: "org", utm_medium: "instagram", utm_term: "bio" },
  stories: { utm_source: "org", utm_medium: "instagram", utm_term: "stories" },
  mc:      { utm_source: "org", utm_medium: "instagram", utm_term: "manychat" },
  dm:      { utm_source: "org", utm_medium: "instagram", utm_term: "direct" },
  yt:      { utm_source: "org", utm_medium: "youtube",   utm_term: "descricao" },
  live:    { utm_source: "org", utm_medium: "instagram", utm_term: "live" },
  zap:     { utm_source: "org", utm_medium: "whatsapp",  utm_term: "grupo" },
  email:   { utm_source: "org", utm_medium: "email",     utm_term: "email" }
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const queryDe = req => {
  const i = req.originalUrl.indexOf("?");
  return i >= 0 ? req.originalUrl.slice(i) : "";
};

export function registrarCaptura(app, { dir, getPool, protegidoCom }) {
  const APPS_SCRIPT_URL = (process.env.APPS_SCRIPT_URL || "").trim();
  const CHAVE = (process.env.APPS_SCRIPT_CHAVE || "").trim();
  const DASH_USER = process.env.DASH_USER || process.env.ADMIN_USER || "admin";
  const DASH_PASS = process.env.DASH_PASS || process.env.ADMIN_PASS || "";

  const ler = f => fs.readFileSync(path.join(dir, "views", f), "utf8");
  const preencher = (html, vars) => html.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  const comuns = { APPS_SCRIPT_URL: esc(APPS_SCRIPT_URL), SIGLA, CAMPANHA };

  /* em desenvolvimento relê o arquivo a cada acesso; em produção, uma vez só */
  const dev = process.env.NODE_ENV !== "production" && !process.env.RAILWAY_ENVIRONMENT;
  const cache = {};
  const view = f => (dev ? ler(f) : (cache[f] ||= ler(f)));

  const html = (res, corpo) => res.set("Cache-Control", "no-cache").type("html").send(corpo);

  /* -------- divisor: a raiz e /srs mandam para uma das 3 versões -------- */
  const dividir = (req, res) => {
    const ks = Object.keys(VERSOES);
    const k = ks[crypto.randomInt(ks.length)];
    res.set("Cache-Control", "no-store").redirect(302, `/${SIGLA}-${k}${queryDe(req)}`);
  };
  app.get("/", dividir);
  app.get(`/${SIGLA}`, dividir);

  /* -------- as 3 versões -------- */
  for (const [k, v] of Object.entries(VERSOES)) {
    app.get(`/${SIGLA}-${k}`, (req, res) =>
      html(res, preencher(view("captura.html"), { ...comuns, VERSAO: k, HEADLINE: v.headline, HEADLINE_TXT: esc(v.texto) })));
  }

  app.get(`/${SIGLA}-obrigado`, (req, res) => html(res, preencher(view("obrigado.html"), comuns)));

  /* -------- links curtos (302) -------- */
  app.get(new RegExp(`^/${SIGLA}-(bio|stories|mc|dm|yt|live|zap|email)(?:-([a-z0-9]{1,20}))?/?$`, "i"), (req, res) => {
    const canal = req.params[0].toLowerCase();
    const sufixo = (req.params[1] || "").toLowerCase();
    const p = new URLSearchParams({ utm_campaign: CAMPANHA, ...CANAIS[canal] });
    if (sufixo) p.set("utm_term", `${CANAIS[canal].utm_term}-${sufixo}`);
    res.set("Cache-Control", "no-store").redirect(302, `/${SIGLA}?${p}`);
  });

  /* -------- backup: cópia de cada envio no Postgres (se a planilha falhar, nada se perde) -------- */
  app.post("/api/captura", async (req, res) => {
    try {
      const corpo = typeof req.body === "object" && req.body ? req.body : {};
      const tipo = corpo.tipo === "pesquisa" ? "pesquisa" : "lead";
      const dados = {};
      for (const [k, v] of Object.entries(corpo).slice(0, 40)) dados[String(k).slice(0, 40)] = String(v ?? "").slice(0, 200);
      const pool = getPool();
      if (pool) {
        await pool.query(`INSERT INTO capturas (tipo, email, dados) VALUES ($1,$2,$3)`,
          [tipo, (dados.email || "").toLowerCase(), dados]);
      } else {
        const f = path.join(dir, "data", "capturas.json");
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const todos = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
        todos.push({ tipo, email: (dados.email || "").toLowerCase(), dados, criado_em: new Date().toISOString() });
        fs.writeFileSync(f, JSON.stringify(todos));
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("backup da captura falhou:", e.message);
      res.status(500).json({ ok: false });
    }
  });

  /* -------- painel -------- */
  const protegido = protegidoCom(DASH_USER, DASH_PASS, "Dash da captação");
  app.get(["/dash", "/dash/"], protegido, (req, res) => html(res, view("dash.html")));

  app.get("/dash/dados", protegido, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (APPS_SCRIPT_URL && CHAVE) {
      try {
        const url = `${APPS_SCRIPT_URL}${APPS_SCRIPT_URL.includes("?") ? "&" : "?"}chave=${encodeURIComponent(CHAVE)}`;
        const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
        const texto = await r.text();
        let json;
        try { json = JSON.parse(texto); } catch { throw new Error("o Apps Script não devolveu JSON (confira a CHAVE e se a implantação está como 'Qualquer pessoa')"); }
        if (json && (json.erro || json.error)) throw new Error(String(json.erro || json.error));
        return res.json({ fonte: "planilha", atualizado: new Date().toISOString(), bruto: semContato(json) });
      } catch (e) {
        console.error("dash: falha ao ler a planilha:", e.message);
        const backup = await lerBackup(getPool, dir).catch(() => null);
        return res.json({ fonte: "backup", aviso: `Planilha indisponível: ${e.message}. Mostrando a cópia de segurança do servidor.`, atualizado: new Date().toISOString(), bruto: semContato(backup) });
      }
    }
    const backup = await lerBackup(getPool, dir).catch(() => ({ leads: [], pesquisa: [] }));
    res.json({ fonte: "backup", aviso: "APPS_SCRIPT_URL e APPS_SCRIPT_CHAVE ainda não foram configuradas no Railway. Mostrando a cópia de segurança do servidor.", atualizado: new Date().toISOString(), bruto: semContato(backup) });
  });
}

/* o dash não precisa de nome nem WhatsApp: eles não saem do servidor */
const CONTATO = new Set(["nome", "whatsapp", "telefone"]);
function semContato(v) {
  if (Array.isArray(v)) {
    if (v.length && Array.isArray(v[0])) {
      const cab = v[0].map(h => String(h).trim().toLowerCase());
      const manter = cab.map((h, i) => (CONTATO.has(h) ? -1 : i)).filter(i => i >= 0);
      return v.map(l => manter.map(i => l[i]));
    }
    return v.map(semContato);
  }
  if (v && typeof v === "object") {
    const r = {};
    for (const [k, x] of Object.entries(v)) if (!CONTATO.has(k.trim().toLowerCase())) r[k] = semContato(x);
    return r;
  }
  return v;
}

/* monta Leads e Pesquisa a partir do backup, no mesmo formato da planilha */
async function lerBackup(getPool, dir) {
  const pool = getPool();
  let linhas;
  if (pool) {
    const { rows } = await pool.query(`SELECT tipo, email, dados, criado_em FROM capturas ORDER BY criado_em ASC`);
    linhas = rows;
  } else {
    const f = path.join(dir, "data", "capturas.json");
    linhas = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
  }
  const leads = new Map();
  const pesquisa = new Map();
  for (const l of linhas) {
    const d = l.dados || {};
    const quando = new Date(l.criado_em).toISOString();
    if (l.tipo === "lead") {
      const { tipo, ...resto } = d;
      leads.set(l.email || `${quando}-${leads.size}`, { data_hora: quando, ...resto });
    } else {
      const atual = pesquisa.get(l.email) || { data_hora: quando, email: l.email };
      const { tipo, ...resto } = d;
      pesquisa.set(l.email, { ...atual, ...resto });
    }
  }
  return { leads: [...leads.values()], pesquisa: [...pesquisa.values()] };
}

export const SQL_CAPTURAS = `
  CREATE TABLE IF NOT EXISTS capturas (
    id        SERIAL PRIMARY KEY,
    tipo      TEXT NOT NULL,
    email     TEXT,
    dados     JSONB NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
