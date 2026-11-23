// Gravação no alerts.jsonl com trava entre processos. Usado pelo monitor (varredura e monitor contínuo), pela limpeza e
// pela exclusão manual do painel.
//
// Por quê: em 19/11 e 23/11/2026 apareceram linhas quebradas no arquivo (pedaços como `a40"}}`), com alertas perdidos.
// A fila dentro de um processo (19/11) não bastou: a varredura e um ciclo do monitor contínuo são processos separados e,
// no volume montado do Docker no Windows, appends simultâneos de processos diferentes se sobrepõem.
//
// Como: a trava é a pasta `<arquivo>.lock` (mkdir é atômico, inclusive no volume montado e no Windows). Quem não
// consegue criá-la espera e tenta de novo. Uma trava mais velha que LOCK_STALE_MS é de um processo que morreu e é
// removida. Dentro do processo, as linhas pendentes saem juntas numa gravação só, para não pegar a trava a cada alerta.

import fs from 'node:fs/promises';

const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Executa fn com a trava do arquivo. Sem conseguir a trava em LOCK_TIMEOUT_MS, lança erro (nada é gravado).
export async function withFileLock(file, fn) {
  const lock = `${file}.lock`;
  const started = Date.now();
  let wait = 5;
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        // Trava abandonada (processo encerrado no meio da gravação).
        await fs.rm(lock, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS) throw new Error(`Trava de ${file} ocupada há mais de ${LOCK_TIMEOUT_MS / 1000} s`);
      await sleep(wait + Math.floor(Math.random() * wait));
      wait = Math.min(wait * 2, 200);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => {});
  }
}

// Acrescenta eventos ao arquivo, um JSON por linha, com a trava.
export async function appendAlertEvents(file, events) {
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return;
  const text = list.map((event) => `${JSON.stringify(event)}\n`).join('');
  await withFileLock(file, () => fs.appendFile(file, text, 'utf8'));
}

// Gravador com fila para um processo que emite muitos alertas (monitor): cada append(event) entra na fila, e as linhas
// pendentes saem juntas na próxima gravação. A promessa de append resolve quando a linha dele foi gravada.
export function createAlertWriter(file) {
  let pending = [];
  let flushing = null;
  const flush = async () => {
    while (pending.length) {
      const batch = pending;
      pending = [];
      try {
        await appendAlertEvents(file, batch.map((item) => item.event));
        for (const item of batch) item.resolve();
      } catch (error) {
        for (const item of batch) item.reject(error);
      }
    }
    flushing = null;
  };
  return {
    append(event) {
      const done = new Promise((resolve, reject) => pending.push({ event, resolve, reject }));
      flushing ??= flush();
      return done;
    },
    // Espera as gravações pendentes (ex.: antes de encerrar o processo).
    async drain() {
      while (flushing) await flushing;
    },
  };
}
