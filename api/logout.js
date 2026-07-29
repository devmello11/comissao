import { handler, limparCookieSessao, metodoNaoPermitido } from "./_lib.js";

export default handler(async (req, res) => {
  if (req.method !== "POST") return metodoNaoPermitido(res, ["POST"]);
  limparCookieSessao(res);
  res.status(200).json({ ok: true });
});
