import {
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
    const rows = await sql`SELECT id, date, description, value, bonus FROM vendas ORDER BY date ASC`;
    res.status(200).json(rows.map(normalizaVenda));
    return;
  }

  if (req.method === "POST") {
    const { ok, dados, erro } = validaVenda(req.body);
    if (!ok) {
      res.status(400).json({ erro });
      return;
    }
    const id = crypto.randomUUID();
    const [row] = await sql`
      INSERT INTO vendas (id, date, description, value, bonus)
      VALUES (${id}, ${dados.date}, ${dados.description}, ${dados.value}, ${dados.bonus})
      RETURNING id, date, description, value, bonus
    `;
    res.status(201).json(normalizaVenda(row));
    return;
  }

  metodoNaoPermitido(res, ["GET", "POST"]);
});
