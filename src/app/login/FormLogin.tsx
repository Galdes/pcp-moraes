"use client";
import { useActionState } from "react";
import { entrarAction, entrarPinAction } from "./actions";

export function FormLogin() {
  const [st, acao, pend] = useActionState(entrarAction, null as null | { erro: string });
  return (
    <form action={acao} className="space-y-3">
      <div>
        <label className="lbl" htmlFor="login">Usuário</label>
        <input id="login" name="login" className="inp" autoComplete="username" required />
      </div>
      <div>
        <label className="lbl" htmlFor="senha">Senha</label>
        <input id="senha" name="senha" type="password" className="inp" autoComplete="current-password" required />
      </div>
      {st?.erro && <p className="text-sm text-alerta">{st.erro}</p>}
      <button className="btn-pri w-full" disabled={pend}>{pend ? "Entrando..." : "Entrar"}</button>
    </form>
  );
}

export function FormPin({ tarefa }: { tarefa?: string }) {
  const [st, acao, pend] = useActionState(entrarPinAction, null as null | { erro: string });
  return (
    <form action={acao} className="space-y-3">
      {tarefa && <input type="hidden" name="tarefa" value={tarefa} />}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="lbl" htmlFor="matricula">Matrícula</label>
          <input id="matricula" name="matricula" inputMode="numeric" className="inp text-lg" required />
        </div>
        <div>
          <label className="lbl" htmlFor="pin">PIN</label>
          <input id="pin" name="pin" type="password" inputMode="numeric" className="inp text-lg" required />
        </div>
      </div>
      {st?.erro && <p className="text-sm text-alerta">{st.erro}</p>}
      <button className="btn w-full border-latao bg-latao text-tinta hover:bg-latao/90" disabled={pend}>Entrar no posto</button>
    </form>
  );
}
