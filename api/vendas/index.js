import {
  exigirAdmin,
  exigirLogin,
  garantirSchema,
  getSql,
  handler,
  metodoNaoPermitido,
  normalizaVenda,
  validaVenda,
} from "../_lib.js";

export default handler(async (req, res) => {
  if (!exigirLogin(req, res)) return;
  await garantirSchema();
  const sql = getSql();

  if (req.method === "GET") {
    const rows = await sql`SELECT id, date, description, value, bonus, category FROM vendas ORDER BY date ASC`;
    res.status(200).json(rows.map(normalizaVenda));
    return;
  }

  if (req.method === "POST") {
    if (!exigirAdmin(req, res)) return;
    const { ok, dados, erro } = validaVenda(req.body);
    if (!ok) {
      res.status(400).json({ erro });
      return;
    }
    const id = crypto.randomUUID();
    const [row] = await sql`
      INSERT INTO vendas (id, date, description, value, bonus, category)
      VALUES (${id}, ${dados.date}, ${dados.description}, ${dados.value}, ${dados.bonus}, ${dados.category})
      RETURNING id, date, description, value, bonus, category
    `;
    res.status(201).json(normalizaVenda(row));
    return;
  }

  metodoNaoPermitido(res, ["GET", "POST"]);
});
