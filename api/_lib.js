import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";

const COOKIE = "caderno_auth";

let _sql = null;
let _schemaPronto = null;

/** Conexão com o Postgres. A Vercel injeta DATABASE_URL ao conectar o banco no painel. */
export function getSql() {
  if (_sql) return _sql;
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error(
      "Banco não configurado: falta a variável de ambiente DATABASE_URL."
    );
  }
  _sql = neon(url);
  return _sql;
}

/** Cria as tabelas na primeira chamada de cada instância da função. */
export function garantirSchema() {
  if (_schemaPronto) return _schemaPronto;
  const sql = getSql();
  _schemaPronto = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS vendas (
        id          TEXT PRIMARY KEY,
        date        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        value       NUMERIC(12, 2) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    // Gorjeta/comissão extra da venda. Coluna adicionada depois — o ADD COLUMN
    // IF NOT EXISTS mantém compatível quem já tinha a tabela criada sem ela.
    await sql`
      ALTER TABLE vendas
      ADD COLUMN IF NOT EXISTS bonus NUMERIC(12, 2) NOT NULL DEFAULT 0
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS metas (
        mes   TEXT PRIMARY KEY,
        valor NUMERIC(12, 2) NOT NULL
      )
    `;
  })().catch((err) => {
    _schemaPronto = null; // permite tentar de novo na próxima chamada
    throw err;
  });
  return _schemaPronto;
}

/** Token derivado da senha — é o que vai no cookie, a senha em si nunca fica salva no navegador. */
function tokenEsperado() {
  const senha = process.env.APP_SENHA;
  if (!senha) {
    throw new Error(
      "Senha não configurada: falta a variável de ambiente APP_SENHA."
    );
  }
  return createHash("sha256").update("caderno:" + senha).digest("hex");
}

function comparaSeguro(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function senhaConfere(senha) {
  return comparaSeguro(
    createHash("sha256").update("caderno:" + String(senha)).digest("hex"),
    tokenEsperado()
  );
}

function lerCookie(req, nome) {
  const raw = req.headers.cookie || "";
  for (const parte of raw.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function setCookieSessao(res) {
  const seguro = process.env.NODE_ENV === "production" ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${tokenEsperado()}; HttpOnly;${seguro} SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}`
  );
}

export function limparCookieSessao(res) {
  const seguro = process.env.NODE_ENV === "production" ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=; HttpOnly;${seguro} SameSite=Lax; Path=/; Max-Age=0`
  );
}

/** Devolve true se a requisição está autenticada; senão já responde 401 e devolve false. */
export function exigirLogin(req, res) {
  const cookie = lerCookie(req, COOKIE);
  if (cookie && comparaSeguro(cookie, tokenEsperado())) return true;
  res.status(401).json({ erro: "nao_autenticado" });
  return false;
}

/** Envolve um handler com try/catch para erros virarem JSON em vez de crash. */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ erro: err.message || "erro_interno" });
      }
    }
  };
}

export function metodoNaoPermitido(res, permitidos) {
  res.setHeader("Allow", permitidos.join(", "));
  res.status(405).json({ erro: "metodo_nao_permitido" });
}

/** Postgres devolve NUMERIC como string — normaliza as vendas para o formato do app. */
export function normalizaVenda(row) {
  return {
    id: row.id,
    date: row.date,
    description: row.description || "",
    value: Number(row.value),
    bonus: Number(row.bonus || 0),
  };
}

/** Valida os campos vindos do cliente. Devolve {ok, dados} ou {ok:false, erro}. */
export function validaVenda(body) {
  const date = String(body?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, erro: "data_invalida" };
  }
  const value = Number(body?.value);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, erro: "valor_invalido" };
  }
  // Gorjeta é opcional: ausente vale 0. Só não pode ser negativa.
  const bonus = body?.bonus === "" || body?.bonus == null ? 0 : Number(body.bonus);
  if (!Number.isFinite(bonus) || bonus < 0) {
    return { ok: false, erro: "gorjeta_invalida" };
  }
  const description = String(body?.description || "").slice(0, 300);
  return { ok: true, dados: { date, description, value, bonus } };
}
