import { handler, metodoNaoPermitido, senhaConfere, setCookieSessao } from "./_lib.js";

export default handler(async (req, res) => {
  if (req.method !== "POST") return metodoNaoPermitido(res, ["POST"]);

  const senha = req.body?.senha;
  if (!senha || !senhaConfere(senha)) {
    res.status(401).json({ erro: "senha_incorreta" });
    return;
  }

  setCookieSessao(res);
  res.status(200).json({ ok: true });
});
