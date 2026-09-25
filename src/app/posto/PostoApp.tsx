"use client";

// Tela do tablet no posto de trabalho.
// Princípios: botões grandes, no máximo 2 toques por ação, funciona com Wi-Fi
// instável (fila local com reenvio e chave de idempotência) e cada registro
// leva menos de 30 segundos.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Setor = { id: number; codigo: string; nome: string };
type Motivo = { id: number; codigo: string; descricao: string; tipo: string };
type Tarefa = {
  id: number;
  descricao: string;
  quantidade: number;
  qtd_boa: number;
  qtd_refugo: number;
  status: "pendente" | "em_processo" | "pausada" | "concluida";
  tempo_previsto_min: number;
  item_codigo: string;
  item_descricao: string;
  op_numero: number;
  data_necessidade: string;
  produto_codigo: string;
  produto_descricao: string;
  pronta: boolean;
  em_curso_desde: string | null;
  motivo_pausa: string | null;
};
type Acao =
  | { tipo: "iniciar"; tarefa_id: number }
  | { tipo: "retomar"; tarefa_id: number }
  | { tipo: "pausar"; tarefa_id: number; motivo_id: number; qtd_boa: number; qtd_refugo: number; motivo_refugo_id?: number | null }
  | { tipo: "concluir"; tarefa_id: number; qtd_boa: number; qtd_refugo: number; motivo_refugo_id?: number | null }
  | { tipo: "parada_setor"; setor_id: number; motivo_id: number }
  | { tipo: "encerrar_parada"; parada_id: number };
type Pendente = { chave: string; acao: Acao; quando: string; usuario_id: number; rotulo: string };
type Rejeitada = Pendente & { erro: string };

const CHAVE_FILA = "posto:pendentes";
const CHAVE_REJEITADAS = "posto:rejeitadas";
const CHAVE_SETOR = "posto:setor";

function ler<T>(k: string, padrao: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : padrao;
  } catch {
    return padrao;
  }
}
function gravar(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* armazenamento indisponível: segue só em memória */
  }
}
function gerarChave() {
  // crypto.randomUUID só existe em https; o tablet pode estar em http na rede local
  const rnd = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join("");
  return `p-${Date.now().toString(36)}-${rnd}`;
}
const fmtQ = (n: number) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const minutosDesde = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
const fmtMin = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`);

export function PostoApp(props: {
  usuario: { id: number; nome: string; setor_id: number | null };
  setores: Setor[];
  motivosParada: Motivo[];
  motivosRefugo: { id: number; descricao: string }[];
  tarefaInicial: number | null;
}) {
  const [setorId, setSetorId] = useState<number | null>(null);
  const [fila, setFila] = useState<Tarefa[]>([]);
  const [paradaSetor, setParadaSetor] = useState<{ id: number; inicio: string; descricao: string } | null>(null);
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [rejeitadas, setRejeitadas] = useState<Rejeitada[]>([]);
  const falhas = useRef(new Map<string, number>());
  const [online, setOnline] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [modal, setModal] = useState<null | { tipo: "pausar" | "concluir"; t: Tarefa } | { tipo: "parada_setor" }>(null);
  const [destaque, setDestaque] = useState<number | null>(props.tarefaInicial);
  const [, forcar] = useState(0);
  const enviando = useRef(false);

  // setor inicial: QR lido > último usado neste tablet > setor do operador
  useEffect(() => {
    (async () => {
      setPendentes(ler<Pendente[]>(CHAVE_FILA, []));
      setRejeitadas(ler<Rejeitada[]>(CHAVE_REJEITADAS, []));
      let s = ler<number | null>(CHAVE_SETOR, null) ?? props.usuario.setor_id ?? props.setores[0]?.id ?? null;
      if (props.tarefaInicial) {
        const r = await fetch(`/api/posto/fila?tarefa=${props.tarefaInicial}`).then((x) => x.json()).catch(() => null);
        if (r?.setor_id) s = r.setor_id;
      }
      setSetorId(s);
    })();
  }, [props.tarefaInicial, props.usuario.setor_id, props.setores]);

  const carregar = useCallback(async () => {
    if (!setorId) return;
    try {
      const r = await fetch(`/api/posto/fila?setor=${setorId}`, { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      const j = await r.json();
      setFila(j.fila);
      setParadaSetor(j.parada);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setCarregando(false);
    }
  }, [setorId]);

  useEffect(() => {
    if (!setorId) return;
    gravar(CHAVE_SETOR, setorId);
    setCarregando(true);
    carregar();
    const id = setInterval(carregar, 20_000);
    const relogio = setInterval(() => forcar((x) => x + 1), 30_000);
    return () => {
      clearInterval(id);
      clearInterval(relogio);
    };
  }, [setorId, carregar]);

  // Remove da fila local só o item enviado, relendo o armazenamento a cada passo:
  // ações novas tocadas pelo operador durante um envio lento não se perdem.
  const tirarDaFila = (chave: string) => {
    const lista = ler<Pendente[]>(CHAVE_FILA, []).filter((p) => p.chave !== chave);
    gravar(CHAVE_FILA, lista);
    setPendentes(lista);
  };
  const rejeitar = (p: Pendente, erro: string) => {
    const lista = [...ler<Rejeitada[]>(CHAVE_REJEITADAS, []), { ...p, erro }].slice(-30);
    gravar(CHAVE_REJEITADAS, lista);
    setRejeitadas(lista);
    tirarDaFila(p.chave);
  };

  const processarFila = useCallback(async () => {
    if (enviando.current) return;
    enviando.current = true;
    try {
      for (;;) {
        // só envia as ações do operador logado; as de outro esperam o login dele
        const p = ler<Pendente[]>(CHAVE_FILA, []).find((x) => x.usuario_id === props.usuario.id);
        if (!p) break;
        let r: Response;
        try {
          r = await fetch("/api/posto/acao", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chave: p.chave, acao: p.acao, quando: p.quando }),
          });
        } catch {
          setOnline(false);
          break;
        }
        if (r.status === 401) {
          setAviso({ tipo: "erro", texto: "Sessão expirada. Entre de novo: as ações pendentes serão enviadas." });
          break;
        }
        const j = await r.json().catch(() => ({}));
        if (r.status >= 500) {
          // erro do servidor: tenta de novo, mas depois de 3 falhas tira da frente para não travar o resto
          const n = (falhas.current.get(p.chave) ?? 0) + 1;
          falhas.current.set(p.chave, n);
          if (n < 3) {
            setOnline(false);
            break;
          }
          rejeitar(p, j.erro ?? "Erro no servidor");
          continue;
        }
        setOnline(true);
        if (r.ok) {
          setAviso({ tipo: "ok", texto: j.mensagem ?? "Registrado" });
          tirarDaFila(p.chave);
        } else {
          setAviso({ tipo: "erro", texto: `${p.rotulo}: ${j.erro ?? "não registrado"}` });
          rejeitar(p, j.erro ?? "Não foi possível registrar");
        }
      }
    } finally {
      enviando.current = false;
      carregar();
    }
  }, [carregar, props.usuario.id]);

  useEffect(() => {
    processarFila();
    const id = setInterval(processarFila, 10_000);
    const volta = () => processarFila();
    window.addEventListener("online", volta);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", volta);
    };
  }, [processarFila]);

  useEffect(() => {
    if (!aviso) return;
    const id = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 8000 : 3500);
    return () => clearTimeout(id);
  }, [aviso]);

  const enviar = (acao: Acao) => {
    const alvo = "tarefa_id" in acao ? fila.find((t) => t.id === acao.tarefa_id) : null;
    const nomes = { iniciar: "Iniciar", retomar: "Retomar", pausar: "Parar", concluir: "Concluir", parada_setor: "Parada do setor", encerrar_parada: "Fim da parada" };
    const rotulo = `${nomes[acao.tipo]}${alvo ? ` · OP ${alvo.op_numero} · ${alvo.item_codigo}` : ""}`;
    const p: Pendente = { chave: gerarChave(), acao, quando: new Date().toISOString(), usuario_id: props.usuario.id, rotulo };
    const lista = [...ler<Pendente[]>(CHAVE_FILA, []), p];
    gravar(CHAVE_FILA, lista);
    setPendentes(lista);
    // resposta imediata na tela (otimista); o servidor confirma em seguida
    if ("tarefa_id" in acao) {
      const novo = { iniciar: "em_processo", retomar: "em_processo", pausar: "pausada", concluir: "concluida" }[acao.tipo as "iniciar"] as Tarefa["status"];
      setFila((f) =>
        f
          .map((t) => (t.id === acao.tarefa_id ? { ...t, status: novo, em_curso_desde: novo === "em_processo" ? new Date().toISOString() : t.em_curso_desde } : t))
          .filter((t) => t.status !== "concluida"),
      );
    }
    setModal(null);
    processarFila();
  };

  const emAndamento = fila.filter((t) => t.status === "em_processo" || t.status === "pausada");
  const prontas = fila.filter((t) => t.status === "pendente" && t.pronta);
  const aguardando = fila.filter((t) => t.status === "pendente" && !t.pronta);
  const setor = props.setores.find((s) => s.id === setorId);

  useEffect(() => {
    if (!destaque || carregando) return;
    const el = document.getElementById(`t-${destaque}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const id = setTimeout(() => setDestaque(null), 6000);
    return () => clearTimeout(id);
  }, [destaque, carregando]);

  return (
    <div className="min-h-screen bg-carta pb-24">
      <header className="sticky top-0 z-10 bg-petroleo text-white shadow">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="coord !text-latao">Posto de trabalho</div>
            <div className="text-xl font-semibold">{setor?.nome ?? "Escolha o setor"}</div>
          </div>
          <div className="flex items-center gap-3 text-right text-sm">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${online ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500 text-white"}`}>
              {online ? "online" : "sem rede"}
              {pendentes.filter((x) => x.usuario_id === props.usuario.id).length > 0 && ` · ${pendentes.filter((x) => x.usuario_id === props.usuario.id).length} a enviar`}
            </span>
            <div>
              <div className="font-medium">{props.usuario.nome}</div>
              <form action="/posto/sair" method="post"><button className="text-xs text-white/60 underline">trocar operador</button></form>
            </div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {props.setores.map((s) => (
            <button
              key={s.id}
              onClick={() => setSetorId(s.id)}
              className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium ${s.id === setorId ? "bg-latao text-tinta" : "bg-white/10 text-white/80"}`}
            >
              {s.nome}
            </button>
          ))}
        </nav>
      </header>

      {aviso && (
        <div role="status" className={`fixed inset-x-4 top-32 z-30 rounded-lg px-4 py-3 text-center text-lg font-semibold shadow-lg ${aviso.tipo === "ok" ? "bg-ok text-white" : "bg-alerta text-white"}`}>
          {aviso.texto}
        </div>
      )}

      <main className="mx-auto max-w-5xl space-y-5 px-4 pt-4">
        {rejeitadas.length > 0 && (
          <div className="rounded-xl border-2 border-alerta bg-red-50 p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-alerta">Ações NÃO registradas ({rejeitadas.length}): refaça ou avise o líder</div>
              <button
                className="rounded-lg border border-alerta/40 bg-white px-3 py-2 text-sm font-semibold text-alerta"
                onClick={() => {
                  gravar(CHAVE_REJEITADAS, []);
                  setRejeitadas([]);
                }}
              >
                Já resolvi
              </button>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {rejeitadas.map((r) => (
                <li key={r.chave}>
                  <b>{r.rotulo}</b> ({new Date(r.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}): {r.erro}
                </li>
              ))}
            </ul>
          </div>
        )}
        {pendentes.some((x) => x.usuario_id !== props.usuario.id) && (
          <div className="rounded-lg bg-atencao/10 px-4 py-2 text-sm">
            {pendentes.filter((x) => x.usuario_id !== props.usuario.id).length} ação(ões) de outro operador ainda não enviadas: serão enviadas quando ele entrar de novo neste tablet.
          </div>
        )}
        {paradaSetor ? (
          <div className="flex items-center justify-between rounded-xl bg-alerta px-5 py-4 text-white">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide">Setor parado há {fmtMin(minutosDesde(paradaSetor.inicio))}</div>
              <div className="text-xl font-semibold">{paradaSetor.descricao}</div>
            </div>
            <button onClick={() => enviar({ tipo: "encerrar_parada", parada_id: paradaSetor.id })} className="rounded-lg bg-white px-5 py-4 text-lg font-bold text-alerta">
              Voltou a funcionar
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button onClick={() => setModal({ tipo: "parada_setor" })} className="rounded-lg border-2 border-alerta/40 bg-white px-4 py-2.5 font-semibold text-alerta">
              Setor parou (sem OP)
            </button>
          </div>
        )}

        {carregando && <div className="py-10 text-center text-apagado">Carregando...</div>}

        {emAndamento.length > 0 && (
          <Secao titulo="Em andamento">
            {emAndamento.map((t) => (
              <CartaoTarefa key={t.id} t={t} destaque={destaque === t.id}>
                {t.status === "em_processo" ? (
                  <>
                    <Botao cor="bg-atencao" onClick={() => setModal({ tipo: "pausar", t })}>Parar</Botao>
                    <Botao cor="bg-ok" onClick={() => setModal({ tipo: "concluir", t })}>Concluir</Botao>
                  </>
                ) : (
                  <>
                    <Botao cor="bg-processo" onClick={() => enviar({ tipo: "retomar", tarefa_id: t.id })}>Retomar</Botao>
                    <Botao cor="bg-ok" onClick={() => setModal({ tipo: "concluir", t })}>Concluir</Botao>
                  </>
                )}
              </CartaoTarefa>
            ))}
          </Secao>
        )}

        {!carregando && (
          <Secao titulo={`Próximas (${prontas.length})`}>
            {prontas.length === 0 && <div className="rounded-lg bg-white p-6 text-center text-apagado">Nenhuma etapa pronta para este setor.</div>}
            {prontas.map((t, i) => (
              <CartaoTarefa key={t.id} t={t} destaque={destaque === t.id} rotulo={i === 0 ? "PRÓXIMA" : `FILA ${i + 1}`}>
                <Botao cor="bg-petroleo" onClick={() => enviar({ tipo: "iniciar", tarefa_id: t.id })}>Iniciar</Botao>
              </CartaoTarefa>
            ))}
          </Secao>
        )}

        {aguardando.length > 0 && (
          <Secao titulo={`Aguardando etapa anterior (${aguardando.length})`}>
            <div className="divide-y divide-linha rounded-lg bg-white">
              {aguardando.slice(0, 12).map((t) => (
                <div key={t.id} id={`t-${t.id}`} className={`flex justify-between px-4 py-2 text-sm ${destaque === t.id ? "bg-latao/20" : ""}`}>
                  <span><b>OP {t.op_numero}</b> · <span className="font-mono">{t.item_codigo}</span> {t.item_descricao}</span>
                  <span className="text-apagado">{fmtQ(t.quantidade)} un</span>
                </div>
              ))}
            </div>
          </Secao>
        )}
      </main>

      {modal?.tipo === "pausar" && (
        <ModalPausa t={modal.t} motivos={props.motivosParada.filter((m) => m.tipo !== "planejada" || m.codigo === "100")} refugos={props.motivosRefugo} onCancelar={() => setModal(null)} onConfirmar={(a) => enviar(a)} />
      )}
      {modal?.tipo === "concluir" && <ModalConcluir t={modal.t} refugos={props.motivosRefugo} onCancelar={() => setModal(null)} onConfirmar={(a) => enviar(a)} />}
      {modal?.tipo === "parada_setor" && setorId && (
        <Modal titulo="Por que o setor parou?" onCancelar={() => setModal(null)}>
          <GradeMotivos motivos={props.motivosParada} onEscolher={(m) => enviar({ tipo: "parada_setor", setor_id: setorId, motivo_id: m })} />
        </Modal>
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-apagado">{titulo}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function CartaoTarefa({ t, children, rotulo, destaque }: { t: Tarefa; children: React.ReactNode; rotulo?: string; destaque?: boolean }) {
  const cor = t.status === "em_processo" ? "border-l-processo" : t.status === "pausada" ? "border-l-alerta" : "border-l-ok";
  const decorrido = minutosDesde(t.em_curso_desde);
  const restante = Math.max(0, t.quantidade - t.qtd_boa);
  return (
    <div id={`t-${t.id}`} className={`rounded-xl border border-linha border-l-8 bg-white p-4 shadow-sm ${cor} ${destaque ? "ring-4 ring-latao" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-apagado">
            {rotulo ?? (t.status === "pausada" ? `PARADA · ${t.motivo_pausa ?? ""}` : `EM PROCESSO · há ${fmtMin(decorrido)}`)} · OP {t.op_numero} · entrega {t.data_necessidade.split("-").reverse().slice(0, 2).join("/")}
          </div>
          <div className="mt-1 text-2xl font-semibold leading-tight">{t.item_descricao}</div>
          <div className="font-mono text-sm text-apagado">{t.item_codigo}</div>
          <div className="mt-1 text-base">{t.descricao}</div>
          <div className="mt-1 text-xs text-apagado">Máquina: {t.produto_codigo} {t.produto_descricao}</div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold tabular-nums">{fmtQ(restante)}</div>
          <div className="text-xs text-apagado">de {fmtQ(t.quantidade)} un · padrão {fmtMin(t.tempo_previsto_min)}</div>
        </div>
      </div>
      <div className="mt-4 flex gap-3">{children}</div>
    </div>
  );
}

function Botao({ cor, onClick, children }: { cor: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`min-h-16 flex-1 rounded-lg px-6 text-xl font-bold text-white shadow active:scale-[0.98] ${cor}`}>
      {children}
    </button>
  );
}

function Modal({ titulo, children, onCancelar }: { titulo: string; children: React.ReactNode; onCancelar: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold">{titulo}</h3>
          <button onClick={onCancelar} className="rounded-lg border border-linha px-4 py-2 text-base">Voltar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function GradeMotivos({ motivos, onEscolher, selecionado }: { motivos: Motivo[]; onEscolher: (id: number) => void; selecionado?: number | null }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {motivos.map((m) => (
        <button key={m.id} onClick={() => onEscolher(m.id)} className={`min-h-14 rounded-lg border-2 px-3 py-2 text-left text-base font-medium ${selecionado === m.id ? "border-petroleo bg-petroleo text-white" : "border-linha bg-carta"}`}>
          <span className="mr-1 font-mono text-xs opacity-60">{m.codigo}</span> {m.descricao}
        </button>
      ))}
    </div>
  );
}

function Contador({ rotulo, valor, onChange }: { rotulo: string; valor: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="lbl !text-sm">{rotulo}</div>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(0, valor - 1))} className="h-14 w-14 rounded-lg border border-linha text-2xl font-bold">−</button>
        <input value={valor} onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(",", ".")) || 0))} inputMode="decimal" className="inp h-14 w-28 text-center !text-2xl font-bold" />
        <button onClick={() => onChange(valor + 1)} className="h-14 w-14 rounded-lg border border-linha text-2xl font-bold">+</button>
      </div>
    </div>
  );
}

function ModalPausa({ t, motivos, refugos, onCancelar, onConfirmar }: { t: Tarefa; motivos: Motivo[]; refugos: { id: number; descricao: string }[]; onCancelar: () => void; onConfirmar: (a: Acao) => void }) {
  const [motivo, setMotivo] = useState<number | null>(null);
  const [boa, setBoa] = useState(0);
  const [refugo, setRefugo] = useState(0);
  const [motRef, setMotRef] = useState<number | null>(null);
  return (
    <Modal titulo={`Parar OP ${t.op_numero}`} onCancelar={onCancelar}>
      <GradeMotivos motivos={motivos} onEscolher={setMotivo} selecionado={motivo} />
      <div className="mt-4 flex flex-wrap gap-6">
        <Contador rotulo="Peças boas feitas até agora" valor={boa} onChange={setBoa} />
        <Contador rotulo="Refugo" valor={refugo} onChange={setRefugo} />
      </div>
      {refugo > 0 && <SelecaoRefugo refugos={refugos} valor={motRef} onChange={setMotRef} />}
      <button
        disabled={!motivo || (refugo > 0 && !motRef)}
        onClick={() => onConfirmar({ tipo: "pausar", tarefa_id: t.id, motivo_id: motivo!, qtd_boa: boa, qtd_refugo: refugo, motivo_refugo_id: motRef })}
        className="mt-5 min-h-16 w-full rounded-lg bg-atencao text-xl font-bold text-white disabled:opacity-40"
      >
        Registrar parada
      </button>
    </Modal>
  );
}

function ModalConcluir({ t, refugos, onCancelar, onConfirmar }: { t: Tarefa; refugos: { id: number; descricao: string }[]; onCancelar: () => void; onConfirmar: (a: Acao) => void }) {
  const falta = useMemo(() => Math.max(0, Number(t.quantidade) - Number(t.qtd_boa)), [t]);
  const [boa, setBoa] = useState(falta);
  const [refugo, setRefugo] = useState(0);
  const [motRef, setMotRef] = useState<number | null>(null);
  return (
    <Modal titulo={`Concluir: ${t.item_descricao}`} onCancelar={onCancelar}>
      <p className="mb-4 text-base text-apagado">OP {t.op_numero} · {t.descricao}. Confirme as quantidades feitas nesta etapa.</p>
      <div className="flex flex-wrap gap-6">
        <Contador rotulo="Peças boas" valor={boa} onChange={setBoa} />
        <Contador rotulo="Refugo" valor={refugo} onChange={setRefugo} />
      </div>
      {boa < falta && <p className="mt-3 text-sm font-medium text-atencao">Atenção: faltam {fmtQ(falta - boa)} peças para a quantidade da OP.</p>}
      {refugo > 0 && <SelecaoRefugo refugos={refugos} valor={motRef} onChange={setMotRef} />}
      <button
        disabled={boa + Number(t.qtd_boa) <= 0 || (refugo > 0 && !motRef)}
        onClick={() => onConfirmar({ tipo: "concluir", tarefa_id: t.id, qtd_boa: boa, qtd_refugo: refugo, motivo_refugo_id: motRef })}
        className="mt-5 min-h-16 w-full rounded-lg bg-ok text-xl font-bold text-white disabled:opacity-40"
      >
        Concluir etapa
      </button>
    </Modal>
  );
}

function SelecaoRefugo({ refugos, valor, onChange }: { refugos: { id: number; descricao: string }[]; valor: number | null; onChange: (v: number) => void }) {
  return (
    <div className="mt-4">
      <div className="lbl !text-sm">Motivo do refugo</div>
      <div className="grid grid-cols-2 gap-2">
        {refugos.map((r) => (
          <button key={r.id} onClick={() => onChange(r.id)} className={`min-h-12 rounded-lg border-2 px-3 text-left ${valor === r.id ? "border-alerta bg-alerta text-white" : "border-linha bg-carta"}`}>
            {r.descricao}
          </button>
        ))}
      </div>
    </div>
  );
}
