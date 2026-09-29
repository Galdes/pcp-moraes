import { NextResponse } from 'next/server';
import { autorizado } from '@/lib/token';
import { importarPaginaDemanda } from '@/server/demanda';

export const maxDuration = 60;
export async function POST(req: Request) {
  if (!autorizado(req, 'CRON_SECRET')) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  try { return NextResponse.json(await importarPaginaDemanda()); }
  catch(e) { console.error('[cron/demanda]', e); return NextResponse.json({ erro: 'Importação não concluída; consulte Integrações' }, { status: 500 }); }
}
