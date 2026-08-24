import { useState, useEffect, useMemo, useRef } from "react";
import { api, NaoAutenticado } from "../api";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const COMISSAO_TAXA = 0.03;

// A lista de categorias vive no banco (tabela categorias, semeada no primeiro acesso).
const SEM_CATEGORIA = "__sem__";

// Paleta categórica validada (banda de luminosidade, chroma, separação para daltonismo
// e piso de visão normal) contra a superfície branca do card. Ordem fixa, nunca reciclada:
// além de 6 fatias o rabo vira "Outras" em cinza, em vez de inventar cor nova.
const CORES_CATEGORIA = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const COR_SEM_CATEGORIA = "#8A9A8F"; // cinza: ausência de categoria não é uma identidade
const COR_OUTRAS = "#5B6B60";
const MAX_FATIAS = 6;

function ymKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function fmtMoney(n) {
  return "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MESES[m - 1]} de ${y}`;
}
function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ymKey(d);
}
/** Comissão da venda: a taxa sobre o valor + a gorjeta, que entra integral. */
function comissaoDe(v) {
  return v.value * COMISSAO_TAXA + (v.bonus || 0);
}
/** Tira acento e caixa pra "balcao" achar "Balcão". */
function normaliza(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
/** Aceita "1.234,50" e "1234.50" — o teclado do celular manda vírgula. */
function paraNumero(s) {
  const txt = String(s ?? "").trim();
  if (!txt) return null;
  // Com vírgula, o ponto é milhar. Sem vírgula, só é milhar se vier em grupos de 3
  // dígitos ("1.234" = 1234), senão é decimal ("1234.50" = 1234,5).
  const ehMilhar = txt.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(txt);
  const limpo = ehMilhar ? txt.replace(/\./g, "").replace(",", ".") : txt;
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

const FILTROS_VAZIOS = {
  busca: "",
  valorMin: "",
  valorMax: "",
  soGorjeta: false,
  categoria: "",
  dia: "",
};

/** Último dia do mês em ISO — limita o seletor de dia ao mês aberto. */
function ultimoDiaDoMes(key) {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Se o texto digitado já existe com outra grafia, devolve a grafia canônica —
 *  evita "no-gi" e "No-GI" virarem duas categorias diferentes no resumo. */
function canonizaCategoria(texto, conhecidas) {
  const alvo = normaliza(texto).trim();
  if (!alvo) return "";
  return conhecidas.find((c) => normaliza(c) === alvo) || String(texto).trim().replace(/\s+/g, " ");
}

export default function CadernoDeVendas() {
  const [vendas, setVendas] = useState([]);
  const [metas, setMetas] = useState({});
  const [perfil, setPerfil] = useState({ usuario: null, papel: "admin" });
  const [currentMonth, setCurrentMonth] = useState(ymKey(new Date()));
  const [sortAsc, setSortAsc] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: "add" } | { mode: "edit", venda }
  const [sessao, setSessao] = useState("verificando"); // verificando | login | pronto
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [dadosLocais, setDadosLocais] = useState(null); // dados antigos do localStorage a migrar
  const [categorias, setCategorias] = useState([]); // lista salva no banco
  const [vendasAberto, setVendasAberto] = useState(true);
  const [gerenciandoCat, setGerenciandoCat] = useState(false);
  const [avisos, setAvisos] = useState([]); // faixas de confirmação que somem sozinhas
  const [confirmacao, setConfirmacao] = useState(null); // pergunta antes de ação destrutiva
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const fileInputRef = useRef(null);

  async function carregar() {
    try {
      const [dados, infoSessao] = await Promise.all([
        api.carregarTudo(),
        api.session().catch(() => ({ usuario: null, papel: "admin" })),
      ]);
      setVendas(dados.vendas);
      setMetas(dados.metas);
      setCategorias(dados.categorias || []);
      setPerfil({ usuario: infoSessao.usuario || null, papel: infoSessao.papel || "admin" });
      setSessao("pronto");
      setErro("");
      if (dados.vendas.length === 0) verificarDadosLocais();
    } catch (e) {
      if (e instanceof NaoAutenticado) {
        setPerfil({ usuario: null, papel: "admin" });
        setSessao("login");
      } else {
        setSessao("pronto");
        setErro(e.message);
      }
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  /** Vendas salvas na versão antiga (localStorage) podem ser enviadas para o banco. */
  function verificarDadosLocais() {
    try {
      const v = JSON.parse(localStorage.getItem("caderno_vendas") || "[]");
      const m = JSON.parse(localStorage.getItem("caderno_metas") || "{}");
      if (Array.isArray(v) && v.length > 0) setDadosLocais({ vendas: v, metas: m });
    } catch {
      /* ignora localStorage corrompido */
    }
  }

  async function migrarDadosLocais() {
    await comApi(async () => {
      const salvos = await api.substituirTudo(dadosLocais.vendas, dadosLocais.metas);
      setVendas(salvos.vendas);
      setMetas(salvos.metas);
      localStorage.removeItem("caderno_vendas");
      localStorage.removeItem("caderno_metas");
      setDadosLocais(null);
    });
  }

  function descartarDadosLocais() {
    localStorage.removeItem("caderno_vendas");
    localStorage.removeItem("caderno_metas");
    setDadosLocais(null);
  }

  /** Faixa de confirmação no canto. Some sozinha — não bloqueia lançar a próxima venda. */
  function avisar(texto, detalhe = "") {
    const id = `${Date.now()}-${Math.random()}`;
    setAvisos((prev) => [...prev, { id, texto, detalhe }]);
    setTimeout(() => setAvisos((prev) => prev.filter((a) => a.id !== id)), 4000);
  }

  /** Pergunta antes de uma ação destrutiva. Resolve true/false. */
  function pedirConfirmacao(opcoes) {
    return new Promise((resolver) => setConfirmacao({ ...opcoes, resolver }));
  }

  function responderConfirmacao(resposta) {
    confirmacao?.resolver(resposta);
    setConfirmacao(null);
  }

  /** Executa uma chamada de API tratando "ocupado", erro e sessão expirada. */
  async function comApi(fn) {
    setOcupado(true);
    setErro("");
    try {
      await fn();
      return true;
    } catch (e) {
      if (e instanceof NaoAutenticado) {
        setSessao("login");
      } else {
        setErro(e.message);
      }
      return false;
    } finally {
      setOcupado(false);
    }
  }

  /** Trocar de mês zera o dia: um dia de julho não existe em agosto e deixaria a lista vazia. */
  function irParaMes(key) {
    setCurrentMonth(key);
    setFiltros((f) => (f.dia ? { ...f, dia: "" } : f));
  }

  /** Escolher um dia de outro mês leva a navegação junto, senão o filtro não acharia nada. */
  function escolherDia(iso) {
    setFiltros((f) => ({ ...f, dia: iso }));
    if (iso && iso.slice(0, 7) !== currentMonth) setCurrentMonth(iso.slice(0, 7));
  }

  async function sair() {
    await api.logout().catch(() => {});
    setVendas([]);
    setMetas({});
    setCategorias([]);
    setPerfil({ usuario: null, papel: "admin" });
    setSessao("login");
  }

  /** Renomeia no banco e reflete nas vendas já carregadas, sem precisar recarregar tudo. */
  async function renomearCategoria(de, para) {
    let ok = false;
    await comApi(async () => {
      const r = await api.renomearCategoria(de, para);
      setCategorias((prev) =>
        prev.map((c) => (normaliza(c) === normaliza(de) ? r.nome : c)).sort((a, b) => a.localeCompare(b, "pt-BR"))
      );
      setVendas((prev) =>
        prev.map((v) => (normaliza(v.category) === normaliza(de) ? { ...v, category: r.nome } : v))
      );
      // Se a categoria renomeada estava filtrando, o filtro segue o novo nome.
      setFiltros((f) => (normaliza(f.categoria) === normaliza(de) ? { ...f, categoria: r.nome } : f));
      avisar(
        `Categoria renomeada para "${r.nome}"`,
        r.afetadas > 0
          ? `${r.afetadas} venda${r.afetadas === 1 ? "" : "s"} atualizada${r.afetadas === 1 ? "" : "s"}`
          : "Nenhuma venda usava essa categoria"
      );
      ok = true;
    });
    return ok;
  }

  async function excluirCategoria(nome) {
    let ok = false;
    await comApi(async () => {
      await api.excluirCategoria(nome);
      setCategorias((prev) => prev.filter((c) => normaliza(c) !== normaliza(nome)));
      setFiltros((f) => (normaliza(f.categoria) === normaliza(nome) ? { ...f, categoria: "" } : f));
      avisar(`Categoria "${nome}" excluída`);
      ok = true;
    });
    return ok;
  }

  /** Cria a categoria no banco e devolve o nome salvo (ou o já existente). */
  async function criarCategoria(nome) {
    let salva = null;
    await comApi(async () => {
      const r = await api.criarCategoria(nome);
      salva = r.nome;
      setCategorias((prev) =>
        prev.some((c) => normaliza(c) === normaliza(r.nome)) ? prev : [...prev, r.nome].sort((a, b) => a.localeCompare(b, "pt-BR"))
      );
    });
    return salva;
  }

  // Tudo do mês: alimenta os cards de resumo e a meta, que não devem mudar com filtro.
  const doMes = useMemo(
    () => vendas.filter((v) => v.date.slice(0, 7) === currentMonth),
    [vendas, currentMonth]
  );

  // Sugestões do campo: a lista salva no banco mais qualquer categoria já usada numa venda
  // (inclusive as que foram removidas da lista depois — a venda antiga continua válida).
  const categoriasConhecidas = useMemo(() => {
    const vistas = new Map();
    for (const c of categorias) vistas.set(normaliza(c), c);
    for (const v of vendas) {
      const c = (v.category || "").trim();
      if (c && !vistas.has(normaliza(c))) vistas.set(normaliza(c), c);
    }
    return [...vistas.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [categorias, vendas]);

  // Categorias que aparecem no filtro: só as que existem neste mês.
  const categoriasDoMes = useMemo(() => {
    const vistas = new Map();
    let temVazia = false;
    for (const v of doMes) {
      const c = (v.category || "").trim();
      if (!c) temVazia = true;
      else if (!vistas.has(normaliza(c))) vistas.set(normaliza(c), c);
    }
    return {
      lista: [...vistas.values()].sort((a, b) => a.localeCompare(b, "pt-BR")),
      temVazia,
    };
  }, [doMes]);

  // Quantas vendas usam cada categoria — em todos os meses, não só no aberto.
  // É o que decide se dá pra excluir e quantas vendas um rename vai atingir.
  const usosPorCategoria = useMemo(() => {
    const conta = {};
    for (const v of vendas) {
      const c = (v.category || "").trim();
      if (!c) continue;
      const k = normaliza(c);
      conta[k] = (conta[k] || 0) + 1;
    }
    return conta;
  }, [vendas]);

  // Quanto cada categoria rendeu no mês, da que mais vendeu para a que menos vendeu.
  const porCategoria = useMemo(() => {
    const acc = new Map();
    for (const v of doMes) {
      const rotulo = (v.category || "").trim() || "Sem categoria";
      const atual = acc.get(rotulo) || { categoria: rotulo, bruto: 0, comissao: 0, qtd: 0 };
      atual.bruto += v.value;
      atual.comissao += comissaoDe(v);
      atual.qtd += 1;
      acc.set(rotulo, atual);
    }
    return [...acc.values()].sort((a, b) => b.bruto - a.bruto);
  }, [doMes]);

  // O que a tabela mostra: o mês já filtrado e ordenado.
  const list = useMemo(() => {
    const busca = normaliza(filtros.busca).trim();
    const min = paraNumero(filtros.valorMin);
    const max = paraNumero(filtros.valorMax);

    const filtrado = doMes.filter((v) => {
      const cat = (v.category || "").trim();
      if (filtros.dia && v.date !== filtros.dia) return false;
      if (busca && !normaliza(v.description + " " + cat).includes(busca)) return false;
      if (min !== null && v.value < min) return false;
      if (max !== null && v.value > max) return false;
      if (filtros.soGorjeta && !(v.bonus > 0)) return false;
      if (filtros.categoria === SEM_CATEGORIA && cat) return false;
      if (filtros.categoria && filtros.categoria !== SEM_CATEGORIA) {
        if (normaliza(cat) !== normaliza(filtros.categoria)) return false;
      }
      return true;
    });

    filtrado.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
    if (!sortAsc) filtrado.reverse();
    return filtrado;
  }, [doMes, filtros, sortAsc]);

  const filtroAtivo =
    filtros.busca.trim() !== "" ||
    filtros.valorMin.trim() !== "" ||
    filtros.valorMax.trim() !== "" ||
    filtros.soGorjeta ||
    filtros.categoria !== "" ||
    filtros.dia !== "";

  // Subtotal do que está filtrado, pra responder "quanto deu só esse recorte".
  const subtotal = useMemo(
    () => ({
      bruto: list.reduce((s, v) => s + v.value, 0),
      comissao: list.reduce((s, v) => s + comissaoDe(v), 0),
    }),
    [list]
  );

  const totalBruto = useMemo(() => doMes.reduce((s, v) => s + v.value, 0), [doMes]);
  const totalGorjetas = useMemo(() => doMes.reduce((s, v) => s + (v.bonus || 0), 0), [doMes]);
  const comissao = totalBruto * COMISSAO_TAXA + totalGorjetas;
  const meta = metas[currentMonth] || 0;
  const pct = meta > 0 ? Math.min(100, (totalBruto / meta) * 100) : 0;
  const hit = meta > 0 && totalBruto >= meta;
  const ehAdmin = perfil.papel === "admin";

  async function addVenda(dados) {
    let criada = null;
    const ok = await comApi(async () => {
      criada = await api.criarVenda(dados);
      setVendas((prev) => [...prev, criada]);
      setCurrentMonth(criada.date.slice(0, 7));
    });
    if (ok) {
      setModal(null);
      avisar(
        `Venda de ${fmtMoney(criada.value)} salva`,
        `${fmtDate(criada.date)} · comissão ${fmtMoney(comissaoDe(criada))}`
      );
    }
  }

  async function updateVenda(id, dados) {
    let atualizada = null;
    const ok = await comApi(async () => {
      atualizada = await api.atualizarVenda(id, dados);
      setVendas((prev) => prev.map((v) => (v.id === id ? atualizada : v)));
      setCurrentMonth(atualizada.date.slice(0, 7));
    });
    if (ok) {
      setModal(null);
      avisar(
        "Venda atualizada",
        `${fmtDate(atualizada.date)} · ${fmtMoney(atualizada.value)} · comissão ${fmtMoney(comissaoDe(atualizada))}`
      );
    }
  }

  async function deleteVenda(id) {
    await comApi(async () => {
      await api.excluirVenda(id);
      setVendas((prev) => prev.filter((v) => v.id !== id));
    });
  }

  async function updateMeta(valor) {
    const mes = currentMonth;
    if ((metas[mes] || 0) === valor) return;
    const ok = await comApi(async () => {
      await api.salvarMeta(mes, valor);
      setMetas((prev) => {
        const proximo = { ...prev };
        if (valor > 0) proximo[mes] = valor;
        else delete proximo[mes];
        return proximo;
      });
    });
    if (ok) {
      avisar(
        valor > 0 ? `Meta salva: ${fmtMoney(valor)}` : "Meta removida",
        monthLabel(mes)
      );
    }
  }

  function exportBackup() {
    const data = { vendas, metas, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-vendas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.vendas) || typeof parsed.metas !== "object") {
          throw new Error("formato inválido");
        }
      } catch {
        alert("Não foi possível importar esse arquivo. Verifique se é um backup válido.");
        return;
      }
      const ok = window.confirm(
        "Isso vai substituir todos os dados do banco pelos dados desse backup. Deseja continuar?"
      );
      if (!ok) return;
      comApi(async () => {
        const salvos = await api.substituirTudo(parsed.vendas, parsed.metas);
        setVendas(salvos.vendas);
        setMetas(salvos.metas);
        if (salvos.ignoradas > 0) {
          alert(`${salvos.ignoradas} venda(s) do arquivo foram ignoradas por estarem inválidas.`);
        }
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  if (sessao === "verificando") {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center text-inkSoft font-sans text-sm">
        Carregando seu caderno de vendas…
      </div>
    );
  }

  if (sessao === "login") {
    return <TelaLogin onEntrar={carregar} />;
  }

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className="max-w-3xl mx-auto px-4 sm:px-5 py-6 sm:py-9 pb-20">
        <Masthead
          currentMonth={currentMonth}
          usuario={perfil.usuario}
          papel={perfil.papel}
          onPrev={() => irParaMes(shiftMonth(currentMonth, -1))}
          onNext={() => irParaMes(shiftMonth(currentMonth, 1))}
          onExport={exportBackup}
          onImportClick={triggerImport}
          onCategorias={() => setGerenciandoCat(true)}
          onSair={sair}
          ocupado={ocupado}
          podeAlterar={ehAdmin}
        />
        <input
          type="file"
          accept="application/json"
          ref={fileInputRef}
          onChange={handleImportFile}
          className="hidden"
        />
        {erro && (
          <div className="mb-4 rounded-lg border border-redStamp/40 bg-[#FBEAE7] px-4 py-2.5 text-sm text-redStamp flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3">
            <span className="break-words">Não foi possível salvar: {erro}</span>
            <button
              onClick={() => carregar()}
              className="font-semibold underline whitespace-nowrap self-start sm:self-auto"
            >
              Recarregar
            </button>
          </div>
        )}
        {dadosLocais && (
          <div className="mb-4 rounded-lg border border-gold bg-[#FDF6E3] px-4 py-3 text-sm">
            <p className="mb-2">
              Encontramos {dadosLocais.vendas.length} venda(s) salvas neste navegador na versão
              antiga. Quer enviá-las para o banco de dados?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={migrarDadosLocais}
                disabled={ocupado}
                className="bg-ink text-paper text-xs font-semibold rounded-lg px-3 py-2 sm:py-1.5 hover:bg-[#142A20] disabled:opacity-50"
              >
                Enviar para o banco
              </button>
              <button
                onClick={descartarDadosLocais}
                className="text-xs font-semibold rounded-lg px-3 py-2 sm:py-1.5 border border-cardBorder hover:bg-paperStripe"
              >
                Descartar
              </button>
            </div>
          </div>
        )}
        <Stats
          totalBruto={totalBruto}
          comissao={comissao}
          totalGorjetas={totalGorjetas}
          count={doMes.length}
          meta={meta}
          pct={pct}
          hit={hit}
          onMetaChange={updateMeta}
          podeAlterar={ehAdmin}
        />
        <ResumoCategorias
          dados={porCategoria}
          totalBruto={totalBruto}
          categoriaAtiva={filtros.categoria}
          onFiltrar={(cat) =>
            setFiltros((f) => ({ ...f, categoria: f.categoria === cat ? "" : cat }))
          }
        />
        <div className="mb-2.5">
          <CabecalhoDobravel
            titulo={<h2 className="font-serif font-semibold text-base m-0">Vendas do mês</h2>}
            aberto={vendasAberto}
            onToggle={() => setVendasAberto((a) => !a)}
            idConteudo="secao-vendas"
          >
            <div className="flex items-center gap-2">
              {!vendasAberto && (
                <span className="text-[11px] text-inkFaint">
                  {doMes.length} venda{doMes.length === 1 ? "" : "s"}
                </span>
              )}
              {ehAdmin && (
                <button
                  onClick={() => {
                    setVendasAberto(true);
                    setModal({ mode: "add" });
                  }}
                  className="bg-ink text-paper text-sm font-semibold rounded-lg px-4 py-2.5 min-h-[44px] whitespace-nowrap hover:bg-[#142A20] transition-colors"
                >
                  + Nova venda
                </button>
              )}
            </div>
          </CabecalhoDobravel>
        </div>
        <div id="secao-vendas" hidden={!vendasAberto}>
          <Filtros
            filtros={filtros}
            setFiltros={setFiltros}
            ativo={filtroAtivo}
            onLimpar={() => setFiltros(FILTROS_VAZIOS)}
            resultados={list.length}
            totalDoMes={doMes.length}
            subtotal={subtotal}
            categoriasDoMes={categoriasDoMes}
            currentMonth={currentMonth}
            onDiaChange={escolherDia}
          />
          <Ledger
            list={list}
            sortAsc={sortAsc}
            onToggleSort={() => setSortAsc((s) => !s)}
            onEdit={(venda) => setModal({ mode: "edit", venda })}
            onDelete={deleteVenda}
            onAddEmpty={() => setModal({ mode: "add" })}
            monthLabel={monthLabel(currentMonth)}
            filtroAtivo={filtroAtivo}
            onLimparFiltros={() => setFiltros(FILTROS_VAZIOS)}
            podeAlterar={ehAdmin}
          />
        </div>
      </div>
      {ehAdmin && gerenciandoCat && (
        <GerenciarCategorias
          categorias={categorias}
          usos={usosPorCategoria}
          ocupado={ocupado}
          onCriar={criarCategoria}
          onRenomear={renomearCategoria}
          onExcluir={excluirCategoria}
          onFechar={() => setGerenciandoCat(false)}
        />
      )}
      {ehAdmin && modal && (
        <VendaModal
          key={modal.mode === "edit" ? modal.venda.id : "add"}
          venda={modal.mode === "edit" ? modal.venda : null}
          currentMonth={currentMonth}
          onCancel={() => setModal(null)}
          categorias={categoriasConhecidas}
          onCriarCategoria={criarCategoria}
          onSave={(dados) =>
            modal.mode === "edit" ? updateVenda(modal.venda.id, dados) : addVenda(dados)
          }
        />
      )}
    </div>
  );
}

function TelaLogin({ onEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      await api.login({ usuario: usuario.trim(), senha });
      await onEntrar();
    } catch (err) {
      setErro(
        err.message === "senha_incorreta"
          ? "Usuário ou senha incorretos."
          : "Não foi possível entrar: " + err.message
      );
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper font-sans text-ink flex items-center justify-center p-5">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-cardBorder rounded-xl w-full max-w-sm p-6 shadow-sm"
      >
        <h1 className="font-serif font-semibold text-2xl tracking-tight m-0">Caderno de vendas</h1>
        <p className="text-xs text-inkSoft uppercase tracking-wide mt-1 mb-5">Acesso restrito</p>
        <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Usuário</label>
        <input
          type="text"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          autoComplete="username"
          placeholder="opcional no modo senha única"
          className="w-full text-base sm:text-sm px-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 mb-3"
        />
        <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Senha</label>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoFocus
          required
          autoComplete="current-password"
          className="w-full font-mono text-base sm:text-sm px-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
        {erro && <p className="text-xs text-redStamp mt-2">{erro}</p>}
        <button
          type="submit"
          disabled={enviando}
          className="w-full mt-4 text-sm font-semibold px-4 py-2.5 min-h-[44px] rounded-lg bg-ink text-paper border border-ink hover:bg-[#142A20] disabled:opacity-50"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

function Masthead({ currentMonth, usuario, papel, onPrev, onNext, onExport, onImportClick, onCategorias, onSair, ocupado, podeAlterar }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4 border-b-2 border-ink pb-3.5 mb-5">
      <div>
        <h1 className="font-serif font-semibold text-2xl sm:text-3xl tracking-tight m-0">
          Caderno de vendas
        </h1>
        <p className="text-xs text-inkSoft uppercase tracking-wide mt-1">
          {usuario ? `${usuario} · ${papel === "admin" ? "admin" : "visualização"}` : "Registro mensal"}
          &middot; comissão de {(COMISSAO_TAXA * 100).toFixed(0)}%
          {ocupado && <span className="ml-2 normal-case tracking-normal">salvando…</span>}
        </p>
      </div>
      <div className="flex flex-col items-stretch sm:items-end gap-2 sm:gap-1.5">
        {/* No celular a navegação ocupa a linha toda: as setas ficam nas bordas, no alcance do polegar. */}
        <div className="flex items-center justify-between sm:justify-end gap-2.5 font-mono">
          <button
            onClick={onPrev}
            aria-label="Mês anterior"
            className="w-11 h-11 sm:w-8 sm:h-8 shrink-0 rounded-md border border-cardBorder hover:bg-paperStripe hover:border-inkFaint flex items-center justify-center text-ink text-lg sm:text-base"
          >
            ‹
          </button>
          <span className="text-sm font-semibold sm:min-w-[128px] text-center capitalize">
            {monthLabel(currentMonth)}
          </span>
          <button
            onClick={onNext}
            aria-label="Próximo mês"
            className="w-11 h-11 sm:w-8 sm:h-8 shrink-0 rounded-md border border-cardBorder hover:bg-paperStripe hover:border-inkFaint flex items-center justify-center text-ink text-lg sm:text-base"
          >
            ›
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            title="Baixar um arquivo .json com todas as vendas e metas"
            className="flex-1 sm:flex-none text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg border border-cardBorder text-ink hover:bg-paperStripe hover:border-inkFaint whitespace-nowrap"
          >
            ↓ Exportar<span className="hidden sm:inline"> JSON</span>
          </button>
          {podeAlterar && (
            <button
              onClick={onImportClick}
              title="Carregar um arquivo .json exportado anteriormente"
              className="flex-1 sm:flex-none text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg border border-cardBorder text-inkSoft hover:bg-paperStripe hover:border-inkFaint hover:text-ink whitespace-nowrap"
            >
              ↑ Importar<span className="hidden sm:inline"> JSON</span>
            </button>
          )}
          {podeAlterar && (
            <button
              onClick={onCategorias}
              title="Criar, renomear ou excluir categorias"
              className="text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg border border-cardBorder text-inkSoft hover:bg-paperStripe hover:border-inkFaint hover:text-ink whitespace-nowrap"
            >
              Categorias
            </button>
          )}
          <button
            onClick={onSair}
            title="Sair"
            className="text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg border border-cardBorder text-inkSoft hover:bg-paperStripe hover:border-inkFaint hover:text-ink"
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

function Stats({ totalBruto, comissao, totalGorjetas, count, meta, pct, hit, onMetaChange, podeAlterar }) {
  const [metaDraft, setMetaDraft] = useState(meta || "");

  useEffect(() => {
    setMetaDraft(meta || "");
  }, [meta]);

  function commit() {
    const val = parseFloat(String(metaDraft).replace(",", "."));
    onMetaChange(isNaN(val) || val < 0 ? 0 : val);
  }

  // No celular: bruto e comissão lado a lado, meta ocupando a linha inteira.
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 mb-5">
      <div className="bg-white border border-cardBorder rounded-[10px] p-3 sm:p-4 shadow-sm">
        <p className="text-[11px] uppercase tracking-wide text-inkSoft mb-1.5">Total bruto</p>
        <p className="font-mono text-lg sm:text-xl font-semibold break-all">{fmtMoney(totalBruto)}</p>
        <p className="text-[11px] text-inkFaint mt-1">
          {count} venda{count === 1 ? "" : "s"} no mês
        </p>
      </div>

      <div className="bg-white border border-cardBorder rounded-[10px] p-3 sm:p-4 shadow-sm">
        <p className="text-[11px] uppercase tracking-wide text-inkSoft mb-1.5">
          Comissão ({(COMISSAO_TAXA * 100).toFixed(0)}%)
        </p>
        <p className="font-mono text-lg sm:text-xl font-semibold text-goldDeep break-all">
          {fmtMoney(comissao)}
        </p>
        <p className="text-[11px] text-inkFaint mt-1">
          {totalGorjetas > 0
            ? `${fmtMoney(totalBruto * COMISSAO_TAXA)} do bruto + ${fmtMoney(totalGorjetas)} em gorjetas`
            : "sobre o total bruto"}
        </p>
      </div>

      <div className="col-span-2 sm:col-span-1 relative bg-white border border-cardBorder rounded-[10px] p-3 sm:p-4 shadow-sm overflow-hidden">
        {hit && (
          <span className="absolute top-2.5 -right-6 rotate-[10deg] border-2 border-greenStamp text-greenStamp font-mono text-[10px] font-semibold uppercase tracking-wide px-6 py-0.5 rounded">
            Meta batida
          </span>
        )}
        <p className="text-[11px] uppercase tracking-wide text-inkSoft mb-1.5">Meta do mês</p>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="0,00"
          value={metaDraft}
          onChange={(e) => setMetaDraft(e.target.value)}
          onBlur={podeAlterar ? commit : undefined}
          disabled={!podeAlterar}
          className="font-mono text-lg sm:text-xl font-semibold bg-transparent border-b border-dashed border-inkFaint focus:border-gold outline-none w-full pb-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <p className="text-[10.5px] text-inkFaint mt-1">
          {podeAlterar ? "Toque para definir a meta em R$" : "Apenas administradores podem alterar a meta."}
        </p>
        <div className="mt-2.5 h-1.5 bg-paperStripe rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${hit ? "bg-greenStamp" : "bg-gold"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[11px] text-inkFaint mt-1">
          {meta > 0 ? `${pct.toFixed(0)}% da meta alcançada` : "Nenhuma meta definida"}
        </p>
      </div>
    </div>
  );
}

/** Cabeçalho de seção com a setinha de minimizar. */
function CabecalhoDobravel({ titulo, aberto, onToggle, idConteudo, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        aria-controls={idConteudo}
        className="flex items-center gap-1.5 text-left rounded -ml-1 px-1 py-1 hover:bg-paperStripe transition-colors"
      >
        <span
          aria-hidden="true"
          className={`text-inkFaint text-xs transition-transform ${aberto ? "" : "-rotate-90"}`}
        >
          ▼
        </span>
        {titulo}
      </button>
      {children}
    </div>
  );
}

/**
 * Monta as fatias da rosca: cor fixa por posição, cinza para "Sem categoria",
 * e o rabo além de MAX_FATIAS somado em "Outras" em vez de gerar cor nova.
 */
function montaFatias(dados) {
  const cabe = dados.length <= MAX_FATIAS;
  const principais = cabe ? dados : dados.slice(0, MAX_FATIAS - 1);
  const resto = cabe ? [] : dados.slice(MAX_FATIAS - 1);

  let proximaCor = 0;
  const fatias = principais.map((c) => {
    const semCategoria = c.categoria === "Sem categoria";
    return {
      ...c,
      semCategoria,
      cor: semCategoria ? COR_SEM_CATEGORIA : CORES_CATEGORIA[proximaCor++ % CORES_CATEGORIA.length],
      agrupa: null,
    };
  });

  if (resto.length > 0) {
    fatias.push({
      categoria: "Outras",
      bruto: resto.reduce((s, c) => s + c.bruto, 0),
      comissao: resto.reduce((s, c) => s + c.comissao, 0),
      qtd: resto.reduce((s, c) => s + c.qtd, 0),
      semCategoria: false,
      cor: COR_OUTRAS,
      agrupa: resto, // as categorias que essa fatia representa
    });
  }
  return fatias;
}

function Rosca({ fatias, total, destaque, selecionada, onDestaque, onFiltrar }) {
  // r escolhido para a circunferência valer 100 — cada unidade é 1% do total.
  const R = 15.9155;
  const GAP = fatias.length > 1 ? 1.2 : 0; // ~2px de respiro entre fatias no tamanho renderizado
  let acumulado = 0;

  // O hover é uma prévia passageira; a seleção é o estado que fica. Quando não há
  // hover, o miolo mostra a fatia selecionada — no celular não existe hover nenhum.
  const foco = destaque !== null ? destaque : selecionada;
  const temSelecao = selecionada !== null;

  return (
    <svg viewBox="0 0 42 42" className="w-[180px] h-[180px] shrink-0" role="img"
      aria-label={`Distribuição do faturamento entre ${fatias.length} categorias`}>
      <circle cx="21" cy="21" r={R} fill="none" stroke="#EEF2E6" strokeWidth="4" />
      {fatias.map((f, i) => {
        const pct = total > 0 ? (f.bruto / total) * 100 : 0;
        const traco = Math.max(pct - GAP, 0.4);
        const offset = 25 - acumulado;
        acumulado += pct;
        const estaEmFoco = foco === i;
        // Padrão de ênfase: com algo selecionado, o resto recua em vez de sumir.
        const apagada = temSelecao && selecionada !== i;
        return (
          <circle
            key={f.categoria}
            cx="21"
            cy="21"
            r={R}
            fill="none"
            stroke={f.cor}
            strokeWidth={estaEmFoco ? 6 : 4}
            strokeOpacity={apagada && !estaEmFoco ? 0.25 : 1}
            strokeDasharray={`${traco} ${100 - traco}`}
            strokeDashoffset={offset}
            strokeLinecap="butt"
            className="cursor-pointer transition-all"
            onMouseEnter={() => onDestaque(i)}
            onMouseLeave={() => onDestaque(null)}
            onClick={() => onFiltrar(f)}
          >
            <title>{`${f.categoria}: ${fmtMoney(f.bruto)} (${pct.toFixed(1)}%)`}</title>
          </circle>
        );
      })}
      {/* Número-herói no miolo. pointer-events none: é rótulo, não pode roubar o clique da fatia. */}
      <text x="21" y={foco === null ? 20.2 : 19.4} textAnchor="middle" className="fill-ink"
        style={{ fontSize: "3.6px", fontWeight: 600, pointerEvents: "none" }}>
        {fmtMoney(foco === null ? total : fatias[foco].bruto).replace("R$ ", "")}
      </text>
      <text x="21" y={foco === null ? 24 : 23} textAnchor="middle" className="fill-inkFaint"
        style={{ fontSize: "2.4px", pointerEvents: "none" }}>
        {foco === null ? "no mês" : `${((fatias[foco].bruto / total) * 100).toFixed(1)}%`}
      </text>
      {foco !== null && (
        <text x="21" y="26.6" textAnchor="middle" className="fill-inkSoft"
          style={{ fontSize: "2.1px", pointerEvents: "none" }}>
          {fatias[foco].categoria.length > 18
            ? fatias[foco].categoria.slice(0, 17) + "…"
            : fatias[foco].categoria}
        </text>
      )}
    </svg>
  );
}

function ResumoCategorias({ dados, totalBruto, categoriaAtiva, onFiltrar }) {
  const [aberto, setAberto] = useState(true);
  const [verTodas, setVerTodas] = useState(false);
  const [destaque, setDestaque] = useState(null);

  const fatias = useMemo(() => montaFatias(dados), [dados]);

  // Qual fatia corresponde ao filtro de categoria que está ativo agora.
  const selecionada = useMemo(() => {
    if (!categoriaAtiva) return null;
    const i = fatias.findIndex(
      (f) => !f.agrupa && (f.semCategoria ? SEM_CATEGORIA : f.categoria) === categoriaAtiva
    );
    return i === -1 ? null : i;
  }, [fatias, categoriaAtiva]);

  // Com uma categoria só não há o que repartir — o card "Total bruto" já diz a mesma coisa.
  if (dados.length < 2) return null;

  const filtrarPor = (f) => {
    if (f.agrupa) return; // "Outras" não é uma categoria de verdade
    onFiltrar(f.semCategoria ? SEM_CATEGORIA : f.categoria);
  };

  return (
    <div className="bg-white border border-cardBorder rounded-[10px] shadow-sm p-3 sm:p-4 mb-5">
      <CabecalhoDobravel
        titulo={
          <span className="text-[11px] uppercase tracking-wide text-inkSoft">
            Por categoria neste mês
          </span>
        }
        aberto={aberto}
        onToggle={() => setAberto((a) => !a)}
        idConteudo="resumo-categorias"
      >
        {!aberto && (
          <span className="text-[11px] text-inkFaint">
            {dados.length} categorias · {fmtMoney(totalBruto)}
          </span>
        )}
      </CabecalhoDobravel>

      {aberto && (
        <div id="resumo-categorias" className="mt-3 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="self-center">
            <Rosca
              fatias={fatias}
              total={totalBruto}
              destaque={destaque}
              selecionada={selecionada}
              onDestaque={setDestaque}
              onFiltrar={filtrarPor}
            />
          </div>

          {/* A legenda carrega nome e número: a cor nunca é a única forma de identificar a fatia. */}
          <ul className="flex-1 min-w-0 flex flex-col gap-0.5">
            {fatias.map((f, i) => {
              const pct = totalBruto > 0 ? (f.bruto / totalBruto) * 100 : 0;
              const valorFiltro = f.semCategoria ? SEM_CATEGORIA : f.categoria;
              const ativa = !f.agrupa && categoriaAtiva === valorFiltro;
              return (
                <li key={f.categoria}>
                  <button
                    onClick={() => filtrarPor(f)}
                    onMouseEnter={() => setDestaque(i)}
                    onMouseLeave={() => setDestaque(null)}
                    aria-pressed={ativa}
                    title={f.agrupa ? "Soma das categorias menores" : ativa ? "Remover filtro" : `Filtrar por ${f.categoria}`}
                    className={`w-full flex items-baseline gap-2 text-left rounded px-2 py-1 -mx-1 transition-colors ${
                      ativa
                        ? "bg-[#FDF6E3] ring-1 ring-gold"
                        : destaque === i
                          ? "bg-paperStripe"
                          : "hover:bg-paperStripe"
                    } ${selecionada !== null && !ativa ? "opacity-50" : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 rounded-sm shrink-0 self-center"
                      style={{ backgroundColor: f.cor }}
                    />
                    <span className={`text-sm truncate min-w-0 flex-1 ${ativa ? "font-semibold" : ""} ${f.semCategoria ? "text-inkFaint italic" : ""}`}>
                      {f.categoria}
                    </span>
                    <span className="text-inkFaint text-[11px] shrink-0">{pct.toFixed(0)}%</span>
                    <span className="font-mono text-sm shrink-0 tabular-nums">{fmtMoney(f.bruto)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {aberto && dados.length > fatias.length && (
        <>
          <button
            onClick={() => setVerTodas((v) => !v)}
            className="mt-2 text-xs font-semibold text-inkSoft hover:text-ink underline"
          >
            {verTodas ? "Ver menos" : `Ver as ${dados.length} categorias`}
          </button>
          {verTodas && (
            <ul className="mt-2 pt-2 border-t border-paperLine flex flex-col gap-0.5">
              {dados.map((c) => (
                <li
                  key={c.categoria}
                  className="flex items-baseline gap-2 text-xs text-inkSoft px-2"
                >
                  <span className="truncate min-w-0 flex-1">{c.categoria}</span>
                  <span className="text-inkFaint shrink-0">({c.qtd})</span>
                  <span className="font-mono shrink-0 tabular-nums">{fmtMoney(c.bruto)}</span>
                  <span className="font-mono text-goldDeep shrink-0 tabular-nums">
                    {fmtMoney(c.comissao)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Filtros({
  filtros,
  setFiltros,
  ativo,
  onLimpar,
  resultados,
  totalDoMes,
  subtotal,
  categoriasDoMes,
  currentMonth,
  onDiaChange,
}) {
  const set = (campo) => (valor) => setFiltros((f) => ({ ...f, [campo]: valor }));

  // Mesmo padrão de campo do modal de venda: rótulo em maiúscula + caixa branca com borda.
  const rotulo = "block text-xs uppercase tracking-wide text-inkSoft mb-1.5";
  const campo =
    "w-full text-base sm:text-sm px-2.5 py-2.5 sm:py-2 border rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20";
  const marcado = (ativo) => (ativo ? "border-gold text-goldDeep font-semibold" : "border-cardBorder");

  return (
    <div className="mb-2.5">
      <div className="bg-white border border-cardBorder rounded-[10px] shadow-sm p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="filtro-busca" className={rotulo}>
              Buscar
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-inkFaint text-sm pointer-events-none">
                ⌕
              </span>
              <input
                id="filtro-busca"
                type="search"
                value={filtros.busca}
                onChange={(e) => set("busca")(e.target.value)}
                placeholder="Descrição ou categoria"
                className={`${campo} ${marcado(filtros.busca.trim() !== "")} pl-8`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="filtro-dia" className={rotulo}>
              Dia
            </label>
            <div className="flex gap-2">
              <input
                id="filtro-dia"
                type="date"
                value={filtros.dia}
                min={`${currentMonth}-01`}
                max={ultimoDiaDoMes(currentMonth)}
                onChange={(e) => onDiaChange(e.target.value)}
                className={`${campo} ${marcado(filtros.dia !== "")} flex-1`}
              />
              <button
                type="button"
                onClick={() => onDiaChange(filtros.dia ? "" : hojeISO())}
                className="text-xs font-semibold px-3 rounded-lg border border-cardBorder text-inkSoft hover:bg-paperStripe hover:text-ink whitespace-nowrap shrink-0"
              >
                {filtros.dia ? "Limpar" : "Hoje"}
              </button>
            </div>
          </div>

          {(categoriasDoMes.lista.length > 0 || categoriasDoMes.temVazia) && (
            <div>
              <label htmlFor="filtro-categoria" className={rotulo}>
                Categoria
              </label>
              <select
                id="filtro-categoria"
                value={filtros.categoria}
                onChange={(e) => set("categoria")(e.target.value)}
                className={`${campo} ${marcado(filtros.categoria !== "")}`}
              >
                <option value="">Todas as categorias</option>
                {categoriasDoMes.lista.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                {categoriasDoMes.temVazia && <option value={SEM_CATEGORIA}>Sem categoria</option>}
              </select>
            </div>
          )}

          <div>
            <span className={rotulo}>Faixa de valor</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={filtros.valorMin}
                onChange={(e) => set("valorMin")(e.target.value)}
                placeholder="mínimo"
                aria-label="Valor mínimo"
                className={`${campo} ${marcado(filtros.valorMin.trim() !== "")} font-mono flex-1 min-w-0`}
              />
              <span className="text-inkFaint text-sm shrink-0">até</span>
              <input
                type="text"
                inputMode="decimal"
                value={filtros.valorMax}
                onChange={(e) => set("valorMax")(e.target.value)}
                placeholder="máximo"
                aria-label="Valor máximo"
                className={`${campo} ${marcado(filtros.valorMax.trim() !== "")} font-mono flex-1 min-w-0`}
              />
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 mt-3 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={filtros.soGorjeta}
            onChange={(e) => set("soGorjeta")(e.target.checked)}
            className="w-4 h-4 accent-[#7C5626]"
          />
          <span className="text-sm">Só vendas com gorjeta</span>
        </label>
      </div>

      {ativo && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-inkSoft">
          <span>
            {resultados} de {totalDoMes} venda{totalDoMes === 1 ? "" : "s"} do mês
            {resultados > 0 && (
              <>
                {" · "}
                <span className="font-mono">{fmtMoney(subtotal.bruto)}</span>
                {" · comissão "}
                <span className="font-mono text-goldDeep">{fmtMoney(subtotal.comissao)}</span>
              </>
            )}
          </span>
          <button
            onClick={onLimpar}
            className="font-semibold underline hover:text-ink whitespace-nowrap"
          >
            Limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}

function Ledger({
  list,
  sortAsc,
  onToggleSort,
  onEdit,
  onDelete,
  onAddEmpty,
  monthLabel,
  filtroAtivo,
  onLimparFiltros,
  podeAlterar,
}) {
  return (
    <div className="bg-white border border-cardBorder rounded-[10px] shadow-sm overflow-hidden">
      {list.length === 0 ? (
        <div className="text-center py-11 px-5">
          {filtroAtivo ? (
            <>
              <p className="font-serif font-semibold text-base mb-1.5">Nenhuma venda encontrada</p>
              <p className="text-sm text-inkSoft mb-4">
                Nenhuma venda de {monthLabel} bate com esses filtros.
              </p>
              <button
                onClick={onLimparFiltros}
                className="text-sm font-semibold rounded-lg px-4 py-2.5 border border-cardBorder hover:bg-paperStripe"
              >
                Limpar filtros
              </button>
            </>
          ) : (
            <>
              <p className="font-serif font-semibold text-base mb-1.5">Nenhuma venda registrada</p>
              <p className="text-sm text-inkSoft mb-4">Adicione a primeira venda de {monthLabel}.</p>
              {podeAlterar && (
                <button
                  onClick={onAddEmpty}
                  className="bg-ink text-paper text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-[#142A20]"
                >
                  + Nova venda
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th
                onClick={onToggleSort}
                className="cursor-pointer select-none text-left text-[11px] uppercase tracking-wide text-inkSoft px-2.5 sm:px-3.5 py-2.5 border-b border-cardBorder bg-paperStripe font-mono hover:text-ink"
              >
                Data {sortAsc ? "↑" : "↓"}
              </th>
              <th className="hidden sm:table-cell text-left text-[11px] uppercase tracking-wide text-inkSoft px-3.5 py-2.5 border-b border-cardBorder bg-paperStripe">
                Descrição
              </th>
              <th className="text-right text-[11px] uppercase tracking-wide text-inkSoft px-2.5 sm:px-3.5 py-2.5 border-b border-cardBorder bg-paperStripe">
                Valor<span className="sm:hidden"> / com.</span>
              </th>
              <th className="hidden sm:table-cell text-right text-[11px] uppercase tracking-wide text-inkSoft px-3.5 py-2.5 border-b border-cardBorder bg-paperStripe">
                Comissão
              </th>
              <th className="border-b border-cardBorder bg-paperStripe"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((v, i) => (
              <tr key={v.id} className={i % 2 === 1 ? "bg-paperStripe" : ""}>
                <td className="align-top text-sm px-2.5 sm:px-3.5 py-2.5 border-b border-paperLine">
                  <span className="font-mono whitespace-nowrap">{fmtDate(v.date)}</span>
                  {/* A coluna Descrição some no celular, então ela reaparece aqui embaixo da data. */}
                  {(v.description || v.bonus > 0 || v.category) && (
                    <span className="block sm:hidden text-xs text-inkSoft mt-0.5 break-words">
                      {v.category && (
                        <span className="block text-ink font-medium">{v.category}</span>
                      )}
                      {v.description}
                      {v.bonus > 0 && (
                        <span className="block text-goldDeep font-mono text-[10px] uppercase tracking-wide mt-0.5 whitespace-nowrap">
                          + gorjeta {fmtMoney(v.bonus)}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="hidden sm:table-cell align-top text-sm text-inkSoft px-3.5 py-2.5 border-b border-paperLine">
                  {v.category && (
                    <span className="inline-block text-[11px] text-ink bg-paperStripe border border-cardBorder rounded px-1.5 py-0.5 mr-1.5 whitespace-nowrap">
                      {v.category}
                    </span>
                  )}
                  {v.description || (v.category ? "" : "—")}
                  {v.bonus > 0 && (
                    <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-goldDeep border border-gold rounded px-1 py-0.5 whitespace-nowrap">
                      gorjeta {fmtMoney(v.bonus)}
                    </span>
                  )}
                </td>
                <td className="font-mono align-top text-right text-sm whitespace-nowrap px-2.5 sm:px-3.5 py-2.5 border-b border-paperLine">
                  {fmtMoney(v.value)}
                  {/* No celular a coluna Comissão some, então ela vem logo abaixo do valor. */}
                  <span className="block sm:hidden text-xs text-goldDeep mt-0.5">
                    {fmtMoney(comissaoDe(v))}
                  </span>
                </td>
                <td className="hidden sm:table-cell font-mono align-top text-right text-sm text-goldDeep whitespace-nowrap px-3.5 py-2.5 border-b border-paperLine">
                  {fmtMoney(comissaoDe(v))}
                </td>
                <td className="align-top whitespace-nowrap px-1 sm:px-2 py-1.5 sm:py-2.5 border-b border-paperLine">
                  {podeAlterar ? (
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => onEdit(v)}
                        aria-label="Editar venda"
                        title="Editar venda"
                        className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-inkFaint hover:text-ink hover:bg-paperStripe rounded text-sm"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => onDelete(v.id)}
                        aria-label="Excluir venda"
                        title="Excluir venda"
                        className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-inkFaint hover:text-redStamp hover:bg-[#FBEAE7] rounded text-base"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end text-[10px] uppercase tracking-wide text-inkFaint">
                      leitura
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GerenciarCategorias({ categorias, usos, ocupado, onCriar, onRenomear, onExcluir, onFechar }) {
  const [editando, setEditando] = useState(null); // nome sendo renomeado
  const [rascunho, setRascunho] = useState("");
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  function comecarEdicao(nome) {
    setEditando(nome);
    setRascunho(nome);
    setErro("");
    setAviso("");
  }

  async function confirmarEdicao() {
    const para = rascunho.trim().replace(/\s+/g, " ");
    if (!para || para === editando) {
      setEditando(null);
      return;
    }
    // Colisão com outra categoria: o servidor recusa, mas avisar antes é mais gentil.
    const colide = categorias.find(
      (c) => normaliza(c) === normaliza(para) && normaliza(c) !== normaliza(editando)
    );
    if (colide) {
      setErro(`Já existe uma categoria "${colide}".`);
      return;
    }
    const quantas = usos[normaliza(editando)] || 0;
    const ok = await onRenomear(editando, para);
    if (!ok) {
      setErro("Não foi possível renomear. Tente de novo.");
      return;
    }
    setAviso(
      quantas > 0
        ? `"${para}" atualizada em ${quantas} venda${quantas === 1 ? "" : "s"}.`
        : `Renomeada para "${para}".`
    );
    setEditando(null);
    setErro("");
  }

  async function criar() {
    const nome = novo.trim().replace(/\s+/g, " ");
    if (!nome) return;
    setErro("");
    const salva = await onCriar(nome);
    if (!salva) {
      setErro("Não foi possível criar.");
      return;
    }
    setNovo("");
    setAviso(`"${salva}" adicionada.`);
  }

  async function excluir(nome) {
    const quantas = usos[normaliza(nome)] || 0;
    setAviso("");
    if (quantas > 0) {
      setErro(
        `"${nome}" está em ${quantas} venda${quantas === 1 ? "" : "s"}. Renomeie, ou troque a categoria dessas vendas antes de excluir.`
      );
      return;
    }
    if (!window.confirm(`Excluir a categoria "${nome}"?`)) return;
    const ok = await onExcluir(nome);
    if (ok) {
      setErro("");
      setAviso(`"${nome}" excluída.`);
    }
  }

  const campo =
    "w-full text-base sm:text-sm px-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20";

  return (
    <div
      className="fixed inset-0 bg-black/35 flex items-end sm:items-center justify-center p-0 sm:p-5 z-50"
      onClick={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="bg-paper border border-cardBorder rounded-t-2xl sm:rounded-xl w-full max-w-md p-5 sm:p-6 shadow-xl max-h-[92vh] sm:max-h-[85vh] overflow-y-auto">
        <h3 className="font-serif font-semibold text-lg mb-1">Categorias</h3>
        <p className="text-xs text-inkSoft mb-4">
          Renomear atualiza também as vendas que já usam a categoria.
        </p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={novo}
            onChange={(e) => {
              setNovo(e.target.value);
              setErro("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                criar();
              }
            }}
            placeholder="Nova categoria"
            maxLength={60}
            className={campo}
          />
          <button
            onClick={criar}
            disabled={ocupado || !novo.trim()}
            className="bg-ink text-paper text-xs font-semibold rounded-lg px-3 py-2 hover:bg-[#142A20] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            Adicionar
          </button>
        </div>

        {erro && (
          <p className="text-xs text-redStamp mb-3 rounded-lg bg-[#FBEAE7] border border-redStamp/40 px-3 py-2">
            {erro}
          </p>
        )}
        {aviso && !erro && (
          <p className="text-xs text-greenStamp mb-3 rounded-lg bg-[#EDF5EF] border border-greenStamp/40 px-3 py-2">
            {aviso}
          </p>
        )}

        {categorias.length === 0 ? (
          <p className="text-sm text-inkSoft py-4 text-center">Nenhuma categoria ainda.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-paperLine border-y border-paperLine">
            {categorias.map((c) => {
              const quantas = usos[normaliza(c)] || 0;
              const emEdicao = editando === c;
              return (
                <li key={c} className="py-2">
                  {emEdicao ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={rascunho}
                        onChange={(e) => setRascunho(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            confirmarEdicao();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setEditando(null);
                          }
                        }}
                        autoFocus
                        maxLength={60}
                        className={campo}
                      />
                      <button
                        onClick={confirmarEdicao}
                        disabled={ocupado}
                        className="bg-ink text-paper text-xs font-semibold rounded-lg px-3 py-2 hover:bg-[#142A20] disabled:opacity-50 shrink-0"
                      >
                        Salvar
                      </button>
                      <button
                        onClick={() => setEditando(null)}
                        className="text-xs font-semibold rounded-lg px-3 py-2 border border-cardBorder bg-white hover:bg-paperStripe shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate min-w-0 flex-1">{c}</span>
                      <span className="text-[11px] text-inkFaint shrink-0">
                        {quantas === 0 ? "sem uso" : `${quantas} venda${quantas === 1 ? "" : "s"}`}
                      </span>
                      <button
                        onClick={() => comecarEdicao(c)}
                        aria-label={`Renomear ${c}`}
                        title="Renomear"
                        className="w-9 h-9 flex items-center justify-center text-inkFaint hover:text-ink hover:bg-paperStripe rounded text-sm shrink-0"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => excluir(c)}
                        aria-label={`Excluir ${c}`}
                        title={quantas > 0 ? "Em uso — renomeie ou libere as vendas" : "Excluir"}
                        className={`w-9 h-9 flex items-center justify-center rounded text-base shrink-0 ${
                          quantas > 0
                            ? "text-inkFaint/40"
                            : "text-inkFaint hover:text-redStamp hover:bg-[#FBEAE7]"
                        }`}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end mt-4">
          <button
            onClick={onFechar}
            className="text-sm font-semibold px-4 py-2.5 sm:py-2 rounded-lg border border-cardBorder bg-white hover:bg-paperStripe"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function VendaModal({ venda, currentMonth, categorias, onCriarCategoria, onCancel, onSave }) {
  const editando = Boolean(venda);
  const today = new Date();
  const defaultDate = ymKey(today) === currentMonth ? today.toISOString().slice(0, 10) : `${currentMonth}-01`;
  const [date, setDate] = useState(venda ? venda.date : defaultDate);
  const [description, setDescription] = useState(venda ? venda.description || "" : "");
  const [categoria, setCategoria] = useState(venda ? venda.category || "" : "");
  const [criandoCat, setCriandoCat] = useState(false);
  const [novaCat, setNovaCat] = useState("");
  const [salvandoCat, setSalvandoCat] = useState(false);
  const [erroCat, setErroCat] = useState("");
  const [valor, setValor] = useState(venda ? String(venda.value) : "");
  const [gorjeta, setGorjeta] = useState(venda?.bonus ? String(venda.bonus) : "");
  // O campo de gorjeta fica escondido até o usuário pedir — na maioria das vendas não tem.
  const [mostraGorjeta, setMostraGorjeta] = useState(Boolean(venda?.bonus));
  const [enviando, setEnviando] = useState(false);

  const bonus = mostraGorjeta ? parseFloat(gorjeta) || 0 : 0;
  const value = parseFloat(valor);
  const comissaoPrevia = (isNaN(value) ? 0 : value) * COMISSAO_TAXA + bonus;

  function cancelarNovaCategoria() {
    setCriandoCat(false);
    setNovaCat("");
    setErroCat("");
  }

  /** Salva a categoria no banco e já deixa ela escolhida na venda. */
  async function salvarNovaCategoria() {
    const nome = novaCat.trim().replace(/\s+/g, " ");
    if (!nome) return;

    const jaExiste = categorias.find((c) => normaliza(c) === normaliza(nome));
    if (jaExiste) {
      // Não trata como erro: só aponta a que já existe e usa ela.
      setCategoria(jaExiste);
      cancelarNovaCategoria();
      return;
    }

    setSalvandoCat(true);
    const salva = await onCriarCategoria(nome);
    setSalvandoCat(false);

    if (!salva) {
      setErroCat("Não foi possível criar. Tente de novo.");
      return;
    }
    setCategoria(salva);
    cancelarNovaCategoria();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // Com o campo de nova categoria aberto, Enter cria a categoria em vez de salvar a venda.
    if (criandoCat) return;
    if (!date || isNaN(value) || value <= 0) return;
    if (bonus < 0) return;
    setEnviando(true);
    await onSave({
      date,
      description: description.trim(),
      value,
      bonus,
      // Casa "no-gi" com "No-GI" pra não duplicar a categoria no resumo.
      category: canonizaCategoria(categoria, categorias),
    });
    setEnviando(false);
  }

  return (
    <div
      className="fixed inset-0 bg-black/35 flex items-end sm:items-center justify-center p-0 sm:p-5 z-50"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      {/* No celular vira uma folha colada embaixo, perto do teclado; no desktop, caixa centralizada. */}
      <div className="bg-paper border border-cardBorder rounded-t-2xl sm:rounded-xl w-full max-w-sm p-5 sm:p-6 shadow-xl max-h-[92vh] sm:max-h-[85vh] overflow-y-auto">
        <h3 className="font-serif font-semibold text-lg mb-4">
          {editando ? "Editar venda" : "Nova venda"}
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-3.5">
            <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full font-mono text-base sm:text-sm px-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div className="mb-3.5">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <label className="block text-xs uppercase tracking-wide text-inkSoft">
                Categoria (opcional)
              </label>
              {!criandoCat && (
                <button
                  type="button"
                  onClick={() => {
                    setCriandoCat(true);
                    setErroCat("");
                  }}
                  className="text-[11px] font-semibold text-goldDeep hover:underline py-1 px-1 -mr-1"
                >
                  + Nova categoria
                </button>
              )}
            </div>

            {criandoCat ? (
              <div className="rounded-lg border border-dashed border-gold bg-[#FDF6E3] p-2.5">
                <input
                  type="text"
                  value={novaCat}
                  onChange={(e) => {
                    setNovaCat(e.target.value);
                    setErroCat("");
                  }}
                  onKeyDown={(e) => {
                    // Enter aqui cria a categoria; sem isso ele enviaria a venda pela metade.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      salvarNovaCategoria();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelarNovaCategoria();
                    }
                  }}
                  placeholder="Nome da nova categoria"
                  autoFocus
                  maxLength={60}
                  className="w-full text-base sm:text-sm px-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
                {erroCat && <p className="text-[11px] text-redStamp mt-1">{erroCat}</p>}
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={salvarNovaCategoria}
                    disabled={salvandoCat || !novaCat.trim()}
                    className="flex-1 bg-ink text-paper text-xs font-semibold rounded-lg px-3 py-2 hover:bg-[#142A20] disabled:opacity-50"
                  >
                    {salvandoCat ? "Criando…" : "Criar e usar"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelarNovaCategoria}
                    className="text-xs font-semibold rounded-lg px-3 py-2 border border-cardBorder bg-white hover:bg-paperStripe"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  list="lista-categorias"
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  placeholder="Escolha ou digite uma nova"
                  autoComplete="off"
                  className="w-full text-base sm:text-sm px-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
                <datalist id="lista-categorias">
                  {categorias.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </div>
          <div className="mb-3.5">
            <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Descrição (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cliente ou produto"
              className="w-full font-mono text-base sm:text-sm px-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div className="mb-3.5">
            <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Valor da venda</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-sm text-inkSoft pointer-events-none">
                R$
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                required
                className="w-full font-mono text-base sm:text-sm pl-9 pr-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>
          </div>

          {mostraGorjeta ? (
            <div className="mb-3.5">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <label className="block text-xs uppercase tracking-wide text-inkSoft">
                  Gorjeta / comissão extra
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMostraGorjeta(false);
                    setGorjeta("");
                  }}
                  className="text-[11px] font-semibold text-inkFaint hover:text-redStamp py-1 px-1 -mr-1"
                >
                  remover
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-sm text-inkSoft pointer-events-none">
                  R$
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={gorjeta}
                  onChange={(e) => setGorjeta(e.target.value)}
                  placeholder="0,00"
                  autoFocus
                  className="w-full font-mono text-base sm:text-sm pl-9 pr-2.5 py-2.5 sm:py-2 border border-cardBorder rounded-lg bg-white focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <p className="text-[11px] text-inkFaint mt-1">
                Entra 100% na comissão, sem contar no total bruto nem na meta.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMostraGorjeta(true)}
              className="w-full mb-3.5 text-xs font-semibold px-3 py-2.5 min-h-[44px] rounded-lg border border-dashed border-gold text-goldDeep hover:bg-[#FDF6E3]"
            >
              + Adicionar gorjeta / comissão extra
            </button>
          )}

          <div className="rounded-lg bg-paperStripe border border-cardBorder px-3 py-2 flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-wide text-inkSoft">
              Comissão desta venda
            </span>
            <span className="font-mono text-sm font-semibold text-goldDeep">
              {fmtMoney(comissaoPrevia)}
            </span>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-semibold px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-lg border border-cardBorder hover:bg-paperStripe"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="text-sm font-semibold px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-lg bg-ink text-paper border border-ink hover:bg-[#142A20] disabled:opacity-50"
            >
              {enviando ? "Salvando…" : editando ? "Salvar alterações" : "Salvar venda"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
