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
  const id = String(req.query.id || "");

  if (req.method === "PUT") {
    if (!exigirAdmin(req, res)) return;
    const { ok, dados, erro } = validaVenda(req.body);
    if (!ok) {
      res.status(400).json({ erro });
      return;
    }
    const [row] = await sql`
      UPDATE vendas
      SET date = ${dados.date}, description = ${dados.description},
          value = ${dados.value}, bonus = ${dados.bonus}, category = ${dados.category}
      WHERE id = ${id}
      RETURNING id, date, description, value, bonus, category
    `;
    if (!row) {
      res.status(404).json({ erro: "venda_nao_encontrada" });
      return;
    }
    res.status(200).json(normalizaVenda(row));
    return;
  }

  if (req.method === "DELETE") {
    if (!exigirAdmin(req, res)) return;
    const rows = await sql`DELETE FROM vendas WHERE id = ${id} RETURNING id`;
    if (rows.length === 0) {
      res.status(404).json({ erro: "venda_nao_encontrada" });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  metodoNaoPermitido(res, ["PUT", "DELETE"]);
});
