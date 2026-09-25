"use server";
import { exigir, hashSegredo, PODE_PLANEJAR } from "@/server/auth";
import { executar, inteiro, numero, texto } from "@/lib/acao";
import { sql } from "@/lib/db";
import { ErroDominio } from "@/domain/tipos";
import { auditar } from "@/server/auditoria";
import { reprogramar } from "@/server/programacao";

export async function salvarSetorAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/cadastros/setores", async () => {
    const dados = {
      codigo: texto(f, "codigo").toUpperCase(),
      nome: texto(f, "nome"),
      sequencia: inteiro(f, "sequencia"),
      recursos: inteiro(f, "recursos", 1),
      horas_turno: numero(f, "horas_turno", 8.8),
      eficiencia: numero(f, "eficiencia", 85) / 100,
      eh_gargalo: f.get("eh_gargalo") === "on",
      ativo: f.get("ativo") !== null ? f.get("ativo") === "on" : true,
    };
    if (!dados.codigo || !dados.nome) throw new ErroDominio("Código e nome são obrigatórios");
    const id = inteiro(f, "id");
    if (id) await sql`update setores set ${sql(dados)}, updated_at = now() where id = ${id}`;
    else await sql`insert into setores ${sql(dados)}`;
    await auditar(u.id, "setor", id || dados.codigo, "salvo", dados);
    await reprogramar();
    return "Setor salvo; programação recalculada";
  });
}

export async function addIndisponibilidadeAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/cadastros/setores", async () => {
    const d = { setor_id: inteiro(f, "setor_id"), inicio: texto(f, "inicio"), fim: texto(f, "fim") || texto(f, "inicio"), recursos_indisponiveis: inteiro(f, "recursos", 1), motivo: texto(f, "motivo") };
    if (!d.motivo || !d.inicio) throw new ErroDominio("Informe período e motivo");
    if (d.fim < d.inicio) throw new ErroDominio("Fim antes do início");
    await sql`insert into indisponibilidades ${sql(d)}`;
    await auditar(u.id, "setor", d.setor_id, "indisponibilidade", d);
    await reprogramar();
    return "Indisponibilidade registrada; programação recalculada";
  });
}

export async function removerIndisponibilidadeAction(f: FormData) {
  await exigir(...PODE_PLANEJAR);
  await executar("/cadastros/setores", async () => {
    await sql`delete from indisponibilidades where id = ${inteiro(f, "id")}`;
    await reprogramar();
    return "Removida";
  });
}

export async function excecaoCalendarioAction(f: FormData) {
  await exigir(...PODE_PLANEJAR);
  await executar("/cadastros/setores", async () => {
    const data = texto(f, "data");
    if (!data) throw new ErroDominio("Informe a data");
    if (f.get("remover")) await sql`delete from calendario_excecoes where data = ${data}`;
    else
      await sql`insert into calendario_excecoes (data, horas, descricao) values (${data}, ${numero(f, "horas")}, ${texto(f, "descricao") || "Exceção"})
                on conflict (data) do update set horas = excluded.horas, descricao = excluded.descricao`;
    await reprogramar();
    return "Calendário atualizado";
  });
}

export async function salvarMotivoAction(f: FormData) {
  await exigir(...PODE_PLANEJAR);
  await executar("/cadastros/motivos", async () => {
    const tabela = texto(f, "tabela");
    const codigo = texto(f, "codigo");
    const descricao = texto(f, "descricao");
    if (!codigo || !descricao) throw new ErroDominio("Código e descrição obrigatórios");
    if (tabela === "parada") {
      const tipo = texto(f, "tipo");
      await sql`insert into motivos_parada (codigo, descricao, tipo) values (${codigo}, ${descricao}, ${tipo})
                on conflict (codigo) do update set descricao = excluded.descricao, tipo = excluded.tipo`;
    } else {
      await sql`insert into motivos_refugo (codigo, descricao) values (${codigo}, ${descricao}) on conflict (codigo) do update set descricao = excluded.descricao`;
    }
    return "Motivo salvo";
  });
}

export async function alternarMotivoAction(f: FormData) {
  await exigir(...PODE_PLANEJAR);
  await executar("/cadastros/motivos", async () => {
    const id = inteiro(f, "id");
    if (texto(f, "tabela") === "parada") await sql`update motivos_parada set ativo = not ativo where id = ${id}`;
    else await sql`update motivos_refugo set ativo = not ativo where id = ${id}`;
    return "Atualizado";
  });
}

const PERFIS = ["admin", "diretoria", "pcp", "lider", "operador", "visualizador"];

export async function salvarUsuarioAction(f: FormData) {
  const u = await exigir("admin");
  await executar("/cadastros/usuarios", async () => {
    const perfil = texto(f, "perfil");
    if (!PERFIS.includes(perfil)) throw new ErroDominio("Perfil inválido");
    const id = inteiro(f, "id");
    const segredo = texto(f, "segredo");
    const operador = perfil === "operador";
    if (segredo) {
      if (operador && !/^\d{4,6}$/.test(segredo)) throw new ErroDominio("PIN deve ter 4 a 6 dígitos");
      if (!operador && segredo.length < 8) throw new ErroDominio("Senha deve ter ao menos 8 caracteres");
    }
    const hash = segredo ? await hashSegredo(segredo) : null;
    const dados = { nome: texto(f, "nome"), login: texto(f, "login"), perfil, setor_id: inteiro(f, "setor_id") || null, ativo: f.get("ativo") !== null ? f.get("ativo") === "on" : true };
    if (!dados.nome || !dados.login) throw new ErroDominio("Nome e login obrigatórios");
    if (id) {
      await sql`update usuarios set ${sql(dados)}, updated_at = now() where id = ${id}`;
      if (hash) await sql`update usuarios set ${operador ? sql`pin_hash` : sql`senha_hash`} = ${hash} where id = ${id}`;
      if (!dados.ativo) await sql`delete from sessoes where usuario_id = ${id}`;
    } else {
      if (!hash) throw new ErroDominio(operador ? "Defina o PIN" : "Defina a senha");
      await sql`insert into usuarios ${sql({ ...dados, senha_hash: operador ? null : hash, pin_hash: operador ? hash : null })}`;
    }
    await auditar(u.id, "usuario", id || dados.login, "salvo", { ...dados, trocou_segredo: !!hash });
    return "Usuário salvo";
  });
}
