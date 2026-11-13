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
    // Venda com vários itens: cada item é uma linha desta tabela, e as linhas da mesma
    // venda compartilham "grupo". Venda de um item só (todas as antigas) fica com grupo
    // NULL — por isso a migração é só aditiva e não toca em nenhuma linha existente.
    await sql`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS grupo TEXT`;
    // Posição do item dentro da venda (as linhas nascem na mesma transação, então
    // created_at empata e não serve para ordenar).
    await sql`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 0`;
    // Cliente da venda (opcionais). São da venda inteira, então ficam repetidos em
    // todas as linhas dela. Vendas antigas ficam com os dois vazios.
    await sql`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cliente TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS telefone TEXT NOT NULL DEFAULT ''`;
    // Entrada (sinal) que o cliente já pagou. É da venda inteira e fica gravada na
    // primeira linha, igual à gorjeta. Não muda o valor da venda nem a comissão:
    // serve para mostrar quanto ainda falta receber.
    await sql`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS entrada NUMERIC(12, 2) NOT NULL DEFAULT 0`;
    // Forma de pagamento da venda: "", "cartao", "pix" ou "cartao+pix" (as duas juntas).
    // É da venda inteira, repetida em todas as linhas dela. Vendas antigas ficam vazias.
    await sql`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS pagamento TEXT NOT NULL DEFAULT ''`;
    // Quanto foi pago em cada forma quando a venda é dividida (ex.: 100 no cartão e 200
    // no Pix). São da venda inteira e ficam na primeira linha, como a entrada.
    await sql`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_cartao NUMERIC(12, 2) NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS valor_pix NUMERIC(12, 2) NOT NULL DEFAULT 0`;
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
    grupo: row.grupo || null,
    ordem: Number(row.ordem || 0),
    cliente: row.cliente || "",
    telefone: row.telefone || "",
    entrada: Number(row.entrada || 0),
    pagamento: row.pagamento || "",
    // No banco as colunas são valor_cartao/valor_pix; no backup JSON já vêm como valorCartao/valorPix.
    valorCartao: Number(row.valor_cartao ?? row.valorCartao ?? 0),
    valorPix: Number(row.valor_pix ?? row.valorPix ?? 0),
  };
}

const FORMAS_PAGAMENTO = ["cartao", "pix"];

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
  // Só vêm preenchidos no "Importar JSON" — é o que mantém os itens de uma venda juntos no backup.
  const grupo = body?.grupo ? String(body.grupo).slice(0, 100) : null;
  const ordemBruta = Number(body?.ordem);
  const ordem = Number.isInteger(ordemBruta) && ordemBruta >= 0 ? ordemBruta : 0;
  // Nome e telefone do cliente: opcionais e livres (telefone não é validado — tem quem
  // anote com DDD, sem DDD, de fora do país ou "o mesmo da esposa").
  const cliente = String(body?.cliente || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const telefone = String(body?.telefone || "").trim().replace(/\s+/g, " ").slice(0, 40);
  // Entrada é opcional: ausente vale 0. Só não pode ser negativa.
  const entrada = body?.entrada === "" || body?.entrada == null ? 0 : Number(body.entrada);
  if (!Number.isFinite(entrada) || entrada < 0) {
    return { ok: false, erro: "entrada_invalida" };
  }
  // Forma de pagamento: opcional. Aceita "pix", "cartao+pix" ou ["cartao", "pix"] e grava
  // sempre na mesma ordem; qualquer valor desconhecido é ignorado.
  const formasPedidas = (
    Array.isArray(body?.pagamento) ? body.pagamento : String(body?.pagamento || "").split("+")
  ).map((f) => String(f).trim().toLowerCase());
  const pagamento = FORMAS_PAGAMENTO.filter((f) => formasPedidas.includes(f)).join("+");
  // Valor em cada forma: só faz sentido com as duas marcadas (pagamento dividido).
  // Com uma forma só, ela vale pela venda inteira e os dois ficam 0.
  const dividido = pagamento === "cartao+pix";
  const valorCartao = dividido && body?.valorCartao !== "" && body?.valorCartao != null ? Number(body.valorCartao) : 0;
  const valorPix = dividido && body?.valorPix !== "" && body?.valorPix != null ? Number(body.valorPix) : 0;
  if (!Number.isFinite(valorCartao) || valorCartao < 0 || !Number.isFinite(valorPix) || valorPix < 0) {
    return { ok: false, erro: "valor_pagamento_invalido" };
  }
  return {
    ok: true,
    dados: {
      date, description, value, bonus, category, grupo, ordem, cliente, telefone, entrada, pagamento,
      valorCartao, valorPix,
    },
  };
}

const MAX_ITENS = 50;

/**
 * Valida uma venda inteira: { date, bonus, itens: [{ category, description, value }] }.
 * Também aceita o formato antigo, de um item só ({ date, description, value, bonus, category }),
 * e avisa em "legado" para a rota responder no formato que aquele cliente espera.
 * A gorjeta é da venda, não do item: fica gravada na primeira linha.
 */
export function validaVendaComItens(body) {
  const legado = !Array.isArray(body?.itens);
  const brutos = legado ? [body] : body.itens;
  if (brutos.length === 0) return { ok: false, erro: "venda_sem_itens" };
  if (brutos.length > MAX_ITENS) return { ok: false, erro: "itens_demais" };

  const itens = [];
  for (let i = 0; i < brutos.length; i++) {
    const r = validaVenda({
      date: body?.date,
      bonus: i === 0 ? body?.bonus : 0,
      value: brutos[i]?.value,
      description: brutos[i]?.description,
      category: brutos[i]?.category,
      cliente: body?.cliente,
      telefone: body?.telefone,
      entrada: i === 0 ? body?.entrada : 0,
      pagamento: body?.pagamento,
      valorCartao: i === 0 ? body?.valorCartao : 0,
      valorPix: i === 0 ? body?.valorPix : 0,
    });
    if (!r.ok) return r;
    itens.push(r.dados);
  }
  // Cartão + Pix não pode somar mais que a venda (pode somar menos: o resto ainda a receber).
  const pagoCentavos = Math.round((itens[0].valorCartao + itens[0].valorPix) * 100);
  if (pagoCentavos > Math.round(itens.reduce((s, it) => s + it.value, 0) * 100)) {
    return { ok: false, erro: "pagamento_maior_que_total" };
  }
  // A entrada abate do total da venda, então não pode passar dele (compara em centavos).
  const totalCentavos = Math.round(itens.reduce((s, it) => s + it.value, 0) * 100);
  if (Math.round(itens[0].entrada * 100) > totalCentavos) {
    return { ok: false, erro: "entrada_maior_que_total" };
  }
  return { ok: true, itens, legado };
}

/**
 * Transforma os itens validados nas linhas a gravar. "chave" identifica a venda:
 * é o id da primeira linha e, quando há mais de um item, o grupo de todas elas.
 * Venda de um item só fica com grupo NULL, igualzinha às vendas antigas.
 */
export function linhasDaVenda(chave, itens) {
  const grupo = itens.length > 1 ? chave : null;
  return itens.map((item, i) => ({
    ...item,
    id: i === 0 ? chave : crypto.randomUUID(),
    grupo,
    ordem: i,
  }));
}
