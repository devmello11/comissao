import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";

const COOKIE = "caderno_auth";

/** Sugestões que existem no primeiro acesso. Depois disso a lista é sua. */
export const CATEGORIAS_INICIAIS = [
  "Kimonos novos",
  "Kimonos usados",
  "Kimonos importados",
  "Kimonos Gracie Barra",
  "No-GI",
  "Protetores bucais",
];

/** Nome normalizado (sem acento, sem caixa, sem espaço sobrando) usado como chave. */
export function chaveCategoria(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Limpa o nome que vai ser exibido. Devolve "" se não sobrar nada. */
export function limpaNomeCategoria(nome) {
  return String(nome || "").trim().replace(/\s+/g, " ").slice(0, 60);
}

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
    // Categoria do item vendido. Texto livre: a lista de sugestões vive no front,
    // então criar categoria nova não exige deploy nem migração.
    await sql`
      ALTER TABLE vendas
      ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT ''
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS metas (
        mes   TEXT PRIMARY KEY,
        valor NUMERIC(12, 2) NOT NULL
      )
    `;
    // Lista de categorias disponíveis. Existe separada das vendas para que uma
    // categoria criada pelo botão sobreviva mesmo sem nenhuma venda usando ela.
    // "chave" é o nome normalizado (sem acento/caixa) e evita duplicata tipo No-GI/no-gi.
    await sql`
      CREATE TABLE IF NOT EXISTS categorias (
        chave TEXT PRIMARY KEY,
        nome  TEXT NOT NULL
      )
    `;
    // Semeia as sugestões iniciais só se a tabela estiver vazia — assim uma categoria
    // que você apagar não volta sozinha no próximo deploy.
    const [{ total }] = await sql`SELECT count(*)::int AS total FROM categorias`;
    if (total === 0) {
      for (const nome of CATEGORIAS_INICIAIS) {
        await sql`
          INSERT INTO categorias (chave, nome) VALUES (${chaveCategoria(nome)}, ${nome})
          ON CONFLICT (chave) DO NOTHING
        `;
      }
    }
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

export function parseUsuarios() {
  const raw = (process.env.APP_USUARIOS || "").trim();
  const usuarios = {};
  if (!raw) return usuarios;

  for (const parte of raw.split(",")) {
    const item = parte.trim();
    if (!item) continue;
    const idx = item.indexOf("=");
    if (idx <= 0) continue;
    const usuario = item.slice(0, idx).trim();
    const restante = item.slice(idx + 1).trim();
    if (!usuario || !restante) continue;

    let senha = restante;
    let papel = "admin";

    const separador = restante.includes("|") ? "|" : restante.includes(":") ? ":" : null;
    if (separador) {
      const pos = restante.lastIndexOf(separador);
      const possivelPapel = restante.slice(pos + 1).trim().toLowerCase();
      if (["admin", "viewer"].includes(possivelPapel)) {
        senha = restante.slice(0, pos).trim();
        papel = possivelPapel;
      }
    }

    usuarios[usuario] = { senha, papel };
  }

  return usuarios;
}

function tokenUsuario(usuario, senha, papel = "admin") {
  return createHash("sha256").update(`caderno:${String(usuario)}:${String(senha)}:${String(papel)}`).digest("hex");
}

function comparaSeguro(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function senhaConfere(senha) {
  const usuarios = parseUsuarios();
  const chaves = Object.keys(usuarios);
  if (chaves.length > 0) {
    return chaves.some((usuario) => {
      const config = usuarios[usuario];
      return comparaSeguro(
        createHash("sha256").update("caderno:" + String(senha)).digest("hex"),
        createHash("sha256").update("caderno:" + String(config.senha)).digest("hex")
      );
    });
  }

  return comparaSeguro(
    createHash("sha256").update("caderno:" + String(senha)).digest("hex"),
    tokenEsperado()
  );
}

export function credenciaisValidas(usuario, senha) {
  const usuarioNormalizado = String(usuario || "").trim();
  const usuarios = parseUsuarios();

  if (usuarioNormalizado) {
    const config = usuarios[usuarioNormalizado];
    if (!config) return false;
    return comparaSeguro(
      createHash("sha256").update("caderno:" + String(senha)).digest("hex"),
      createHash("sha256").update("caderno:" + String(config.senha)).digest("hex")
    );
  }

  if (Object.keys(usuarios).length > 0) return false;
  return senhaConfere(senha);
}

export function papelDoUsuario(usuario) {
  const usuarios = parseUsuarios();
  const config = usuarios[String(usuario || "").trim()];
  return config?.papel || "admin";
}

function lerCookie(req, nome) {
  const raw = req.headers.cookie || "";
  for (const parte of raw.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function setCookieSessao(res, usuario = null, senha = null) {
  const seguro = process.env.NODE_ENV === "production" ? " Secure;" : "";
  const papel = usuario ? papelDoUsuario(usuario) : "admin";
  const valor = usuario && senha
    ? `${encodeURIComponent(usuario)}|${papel}|${tokenUsuario(usuario, senha, papel)}`
    : tokenEsperado();
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${valor}; HttpOnly;${seguro} SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}`
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
export function perfilAutenticado(req) {
  const cookie = lerCookie(req, COOKIE);
  if (!cookie) return null;

  if (cookie.includes("|")) {
    const partes = cookie.split("|");
    const usuarioRaw = partes[0];
    const papel = (partes[1] || "admin").toLowerCase();
    const tokenRaw = partes[2] || "";
    const usuario = decodeURIComponent(usuarioRaw || "");
    const usuarios = parseUsuarios();
    const config = usuarios[usuario];
    if (usuario && config && tokenRaw) {
      const hashEsperado = tokenUsuario(usuario, config.senha, config.papel || papel);
      if (comparaSeguro(tokenRaw, hashEsperado)) {
        return { usuario, papel: config.papel || papel };
      }
    }
  }

  if (process.env.APP_SENHA && cookie && comparaSeguro(cookie, tokenEsperado())) {
    return { usuario: null, papel: "admin" };
  }

  return null;
}

export function exigirLogin(req, res) {
  const perfil = perfilAutenticado(req);
  if (perfil) return true;
  res.status(401).json({ erro: "nao_autenticado" });
  return false;
}

export function exigirAdmin(req, res) {
  const perfil = perfilAutenticado(req);
  if (perfil?.papel === "admin") return true;
  res.status(403).json({ erro: "acesso_negado" });
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
    category: row.category || "",
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
  // Categoria é opcional — venda sem categoria fica como "" e aparece como "Sem categoria".
  const category = String(body?.category || "").trim().replace(/\s+/g, " ").slice(0, 60);
  return { ok: true, dados: { date, description, value, bonus, category } };
}
