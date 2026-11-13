import {
  exigirAdmin,
  exigirLogin,
  garantirSchema,
  getSql,
  handler,
  metodoNaoPermitido,
  normalizaVenda,
  validaVenda,
} from "./_lib.js";

export default handler(async (req, res) => {
  if (!exigirLogin(req, res)) return;
  await garantirSchema();
  const sql = getSql();

  // GET: carrega tudo de uma vez (usado na abertura do app).
  if (req.method === "GET") {
    const [vendas, metas, categorias] = await Promise.all([
      sql`
        SELECT id, date, description, value, bonus, category, grupo, ordem, cliente, telefone, entrada, pagamento, valor_cartao, valor_pix
        FROM vendas ORDER BY date ASC, created_at ASC, ordem ASC
      `,
      sql`SELECT mes, valor FROM metas`,
      sql`SELECT nome FROM categorias ORDER BY nome ASC`,
    ]);
    res.status(200).json({
      vendas: vendas.map(normalizaVenda),
      metas: Object.fromEntries(metas.map((m) => [m.mes, Number(m.valor)])),
      categorias: categorias.map((c) => c.nome),
    });
    return;
  }

  // PUT: substitui tudo (usado pelo "Importar JSON").
  if (req.method === "PUT") {
    if (!exigirAdmin(req, res)) return;
    const vendasEntrada = Array.isArray(req.body?.vendas) ? req.body.vendas : null;
    const metasEntrada = req.body?.metas;
    if (!vendasEntrada || typeof metasEntrada !== "object" || metasEntrada === null) {
      res.status(400).json({ erro: "formato_invalido" });
      return;
    }

    const vendas = [];
    for (const bruta of vendasEntrada) {
      const { ok, dados } = validaVenda(bruta);
      if (!ok) continue; // ignora linhas quebradas do backup em vez de perder o resto
      vendas.push({ id: String(bruta.id || crypto.randomUUID()), ...dados });
    }

    const metas = Object.entries(metasEntrada)
      .filter(([mes, valor]) => /^\d{4}-\d{2}$/.test(mes) && Number(valor) > 0)
      .map(([mes, valor]) => ({ mes, valor: Number(valor) }));

    await sql.transaction([
      sql`DELETE FROM vendas`,
      sql`DELETE FROM metas`,
      ...vendas.map(
        (v) => sql`
          INSERT INTO vendas (id, date, description, value, bonus, category, grupo, ordem, cliente, telefone, entrada, pagamento, valor_cartao, valor_pix)
          VALUES (${v.id}, ${v.date}, ${v.description}, ${v.value}, ${v.bonus}, ${v.category}, ${v.grupo}, ${v.ordem}, ${v.cliente}, ${v.telefone}, ${v.entrada}, ${v.pagamento}, ${v.valorCartao}, ${v.valorPix})
          ON CONFLICT (id) DO NOTHING
        `
      ),
      ...metas.map(
        (m) => sql`
          INSERT INTO metas (mes, valor) VALUES (${m.mes}, ${m.valor})
          ON CONFLICT (mes) DO UPDATE SET valor = EXCLUDED.valor
        `
      ),
    ]);

    res.status(200).json({
      vendas,
      metas: Object.fromEntries(metas.map((m) => [m.mes, m.valor])),
      ignoradas: vendasEntrada.length - vendas.length,
    });
    return;
  }

  metodoNaoPermitido(res, ["GET", "PUT"]);
});
