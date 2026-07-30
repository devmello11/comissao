import { useState, useEffect, useMemo, useRef } from "react";
import { api, NaoAutenticado } from "../api";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const COMISSAO_TAXA = 0.03;

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

export default function CadernoDeVendas() {
  const [vendas, setVendas] = useState([]);
  const [metas, setMetas] = useState({});
  const [currentMonth, setCurrentMonth] = useState(ymKey(new Date()));
  const [sortAsc, setSortAsc] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: "add" } | { mode: "edit", venda }
  const [sessao, setSessao] = useState("verificando"); // verificando | login | pronto
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [dadosLocais, setDadosLocais] = useState(null); // dados antigos do localStorage a migrar
  const fileInputRef = useRef(null);

  async function carregar() {
    try {
      const dados = await api.carregarTudo();
      setVendas(dados.vendas);
      setMetas(dados.metas);
      setSessao("pronto");
      setErro("");
      if (dados.vendas.length === 0) verificarDadosLocais();
    } catch (e) {
      if (e instanceof NaoAutenticado) {
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

  async function sair() {
    await api.logout().catch(() => {});
    setVendas([]);
    setMetas({});
    setSessao("login");
  }

  const list = useMemo(() => {
    const filtered = vendas.filter((v) => v.date.slice(0, 7) === currentMonth);
    filtered.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
    if (!sortAsc) filtered.reverse();
    return filtered;
  }, [vendas, currentMonth, sortAsc]);

  const totalBruto = useMemo(() => list.reduce((s, v) => s + v.value, 0), [list]);
  const totalGorjetas = useMemo(() => list.reduce((s, v) => s + (v.bonus || 0), 0), [list]);
  const comissao = totalBruto * COMISSAO_TAXA + totalGorjetas;
  const meta = metas[currentMonth] || 0;
  const pct = meta > 0 ? Math.min(100, (totalBruto / meta) * 100) : 0;
  const hit = meta > 0 && totalBruto >= meta;

  async function addVenda(dados) {
    const ok = await comApi(async () => {
      const criada = await api.criarVenda(dados);
      setVendas((prev) => [...prev, criada]);
      setCurrentMonth(criada.date.slice(0, 7));
    });
    if (ok) setModal(null);
  }

  async function updateVenda(id, dados) {
    const ok = await comApi(async () => {
      const atualizada = await api.atualizarVenda(id, dados);
      setVendas((prev) => prev.map((v) => (v.id === id ? atualizada : v)));
      setCurrentMonth(atualizada.date.slice(0, 7));
    });
    if (ok) setModal(null);
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
    await comApi(async () => {
      await api.salvarMeta(mes, valor);
      setMetas((prev) => {
        const proximo = { ...prev };
        if (valor > 0) proximo[mes] = valor;
        else delete proximo[mes];
        return proximo;
      });
    });
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
          onPrev={() => setCurrentMonth(shiftMonth(currentMonth, -1))}
          onNext={() => setCurrentMonth(shiftMonth(currentMonth, 1))}
          onExport={exportBackup}
          onImportClick={triggerImport}
          onSair={sair}
          ocupado={ocupado}
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
          count={list.length}
          meta={meta}
          pct={pct}
          hit={hit}
          onMetaChange={updateMeta}
        />
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <h2 className="font-serif font-semibold text-base m-0">Vendas do mês</h2>
          <button
            onClick={() => setModal({ mode: "add" })}
            className="bg-ink text-paper text-sm font-semibold rounded-lg px-4 py-2.5 min-h-[44px] whitespace-nowrap hover:bg-[#142A20] transition-colors"
          >
            + Nova venda
          </button>
        </div>
        <Ledger
          list={list}
          sortAsc={sortAsc}
          onToggleSort={() => setSortAsc((s) => !s)}
          onEdit={(venda) => setModal({ mode: "edit", venda })}
          onDelete={deleteVenda}
          onAddEmpty={() => setModal({ mode: "add" })}
          monthLabel={monthLabel(currentMonth)}
        />
      </div>
      {modal && (
        <VendaModal
          key={modal.mode === "edit" ? modal.venda.id : "add"}
          venda={modal.mode === "edit" ? modal.venda : null}
          currentMonth={currentMonth}
          onCancel={() => setModal(null)}
          onSave={(dados) =>
            modal.mode === "edit" ? updateVenda(modal.venda.id, dados) : addVenda(dados)
          }
        />
      )}
    </div>
  );
}

function TelaLogin({ onEntrar }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      await api.login(senha);
      await onEntrar();
    } catch (err) {
      setErro(
        err.message === "senha_incorreta"
          ? "Senha incorreta."
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
        <label className="block text-xs uppercase tracking-wide text-inkSoft mb-1.5">Senha</label>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoFocus
          required
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

function Masthead({ currentMonth, onPrev, onNext, onExport, onImportClick, onSair, ocupado }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4 border-b-2 border-ink pb-3.5 mb-5">
      <div>
        <h1 className="font-serif font-semibold text-2xl sm:text-3xl tracking-tight m-0">
          Caderno de vendas
        </h1>
        <p className="text-xs text-inkSoft uppercase tracking-wide mt-1">
          Registro mensal &middot; comissão de {(COMISSAO_TAXA * 100).toFixed(0)}%
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
          <button
            onClick={onImportClick}
            title="Carregar um arquivo .json exportado anteriormente"
            className="flex-1 sm:flex-none text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg border border-cardBorder text-inkSoft hover:bg-paperStripe hover:border-inkFaint hover:text-ink whitespace-nowrap"
          >
            ↑ Importar<span className="hidden sm:inline"> JSON</span>
          </button>
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

function Stats({ totalBruto, comissao, totalGorjetas, count, meta, pct, hit, onMetaChange }) {
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
          onBlur={commit}
          className="font-mono text-lg sm:text-xl font-semibold bg-transparent border-b border-dashed border-inkFaint focus:border-gold outline-none w-full pb-0.5"
        />
        <p className="text-[10.5px] text-inkFaint mt-1">Toque para definir a meta em R$</p>
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

function Ledger({ list, sortAsc, onToggleSort, onEdit, onDelete, onAddEmpty, monthLabel }) {
  return (
    <div className="bg-white border border-cardBorder rounded-[10px] shadow-sm overflow-hidden">
      {list.length === 0 ? (
        <div className="text-center py-11 px-5">
          <p className="font-serif font-semibold text-base mb-1.5">Nenhuma venda registrada</p>
          <p className="text-sm text-inkSoft mb-4">Adicione a primeira venda de {monthLabel}.</p>
          <button
            onClick={onAddEmpty}
            className="bg-ink text-paper text-sm font-semibold rounded-lg px-4 py-2 hover:bg-[#142A20]"
          >
            + Nova venda
          </button>
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
                  {(v.description || v.bonus > 0) && (
                    <span className="block sm:hidden text-xs text-inkSoft mt-0.5 break-words">
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
                  {v.description || "—"}
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function VendaModal({ venda, currentMonth, onCancel, onSave }) {
  const editando = Boolean(venda);
  const today = new Date();
  const defaultDate = ymKey(today) === currentMonth ? today.toISOString().slice(0, 10) : `${currentMonth}-01`;
  const [date, setDate] = useState(venda ? venda.date : defaultDate);
  const [description, setDescription] = useState(venda ? venda.description || "" : "");
  const [valor, setValor] = useState(venda ? String(venda.value) : "");
  const [gorjeta, setGorjeta] = useState(venda?.bonus ? String(venda.bonus) : "");
  // O campo de gorjeta fica escondido até o usuário pedir — na maioria das vendas não tem.
  const [mostraGorjeta, setMostraGorjeta] = useState(Boolean(venda?.bonus));
  const [enviando, setEnviando] = useState(false);

  const bonus = mostraGorjeta ? parseFloat(gorjeta) || 0 : 0;
  const value = parseFloat(valor);
  const comissaoPrevia = (isNaN(value) ? 0 : value) * COMISSAO_TAXA + bonus;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!date || isNaN(value) || value <= 0) return;
    if (bonus < 0) return;
    setEnviando(true);
    await onSave({ date, description: description.trim(), value, bonus });
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
