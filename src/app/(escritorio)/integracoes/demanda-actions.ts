"use server";
import { exigir } from '@/server/auth';
import { importarPaginaDemanda } from '@/server/demanda';
import { revalidatePath } from 'next/cache';

export async function importarDemandaAction() {
  await exigir('admin', 'pcp');
  try {
    const r = await importarPaginaDemanda();
    revalidatePath('/');
    revalidatePath('/integracoes');
    return { ...r, erro: false };
  } catch(e) {
    console.error('[demanda]', e);
    return { concluido: false, erro: true, mensagem: 'Importação interrompida. Os meses completos anteriores foram preservados. Confira o diagnóstico abaixo e retome.' };
  }
}
