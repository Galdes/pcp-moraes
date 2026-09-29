"use client";
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importarDemandaAction } from '@/app/(escritorio)/integracoes/demanda-actions';

export function ImportarDemanda() {
  const [rodando, setRodando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const parar = useRef(false);
  const router = useRouter();
  async function iniciar() {
    if (rodando) return;
    parar.current = false;
    setRodando(true);
    try {
      // Uma página por requisição para respeitar o tempo de execução da hospedagem.
      for (let passo = 0; passo < 1000 && !parar.current; passo++) {
        const r = await importarDemandaAction();
        setMensagem(r.mensagem);
        if (r.concluido || r.erro) break;
        if ('aguardar' in r && r.aguardar) await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch { setMensagem('Conexão interrompida. Você pode retomar a importação.'); }
    finally { setRodando(false); router.refresh(); }
  }
  return <div className="space-y-2">
    <button type="button" className="btn-pri" disabled={rodando} onClick={iniciar}>{rodando ? 'Importando…' : 'Importar / atualizar 24 meses'}</button>
    {rodando && <button type="button" className="btn-sec ml-2" onClick={() => { parar.current = true; setMensagem('Pausando após a página atual…'); }}>Pausar</button>}
    <p role="status" aria-live="polite" className="text-sm">{mensagem}</p>
    <p className="text-xs text-apagado">Mantenha esta tela aberta. A importação pode ser retomada; ela apenas lê notas e não gera OPs ou compras.</p>
  </div>;
}
