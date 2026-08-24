import {
  exigirAdmin,
  exigirLogin,
  garantirSchema,
  getSql,
  handler,
  metodoNaoPermitido,
} from "./_lib.js";

export default handler(async (req, res) => {
  if (!exigirLogin(req, res)) return;
  await garantirSchema();
  const sql = getSql();

  if (req.method === "GET") {
    const rows = await sql`SELECT mes, valor FROM metas`;
    res.status(200).json(Object.fromEntries(rows.map((m) => [m.mes, Number(m.valor)])));
    return;
  }

  // PUT define (ou apaga, se valor <= 0) a meta de um mês.
  if (req.method === "PUT") {
    if (!exigirAdmin(req, res)) return;
    const mes = String(req.body?.mes || "");
    const valor = Number(req.body?.valor);
    if (!/^\d{4}-\d{2}$/.test(mes) || !Number.isFinite(valor) || valor < 0) {
      res.status(400).json({ erro: "dados_invalidos" });
      return;
    }
    if (valor === 0) {
      await sql`DELETE FROM metas WHERE mes = ${mes}`;
    } else {
      await sql`
        INSERT INTO metas (mes, valor) VALUES (${mes}, ${valor})
        ON CONFLICT (mes) DO UPDATE SET valor = EXCLUDED.valor
      `;
    }
    res.status(200).json({ mes, valor });
    return;
  }

  metodoNaoPermitido(res, ["GET", "PUT"]);
});
