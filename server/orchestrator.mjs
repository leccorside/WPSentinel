// Orquestrador de processos em segundo plano (Passo 4): trabalhos, monitor contínuo, limpeza interativa e SSE.
import { spawn } from 'node:child_process';
import process from 'node:process';
import { readEnvFile } from './config.mjs';

const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;
const MAX_LOGS = 1000;
const RECENT_LOGS_LIMIT = 300;

export const JOB_SPECS = {
  scan: {
    label: 'Varredura',
    args: ['src/monitor.mjs', '--once'],
  },
  scan_full: {
    label: 'Varredura com hash completo',
    args: ['src/monitor.mjs', '--once', '--full-hash'],
  },
  plan: {
    label: 'Gerar plano de limpeza',
    args: ['src/clean.mjs', '--plan'],
  },
  clean: {
    label: 'Limpeza',
    args: ['src/clean.mjs'],
  },
  reset_baseline: {
    label: 'Redefinir baseline',
    args: ['src/monitor.mjs', '--reset-baseline', '--once'],
  },
};

export function createOrchestrator({ rootDir, onNotification = null }) {
  let notificationHandler = onNotification;
  let currentJob = null;
  let lastJob = null;
  let resumingMonitorAfterJob = false;

  function notify(data) {
    if (typeof notificationHandler === 'function') {
      try {
        notificationHandler(data);
      } catch (err) {
        console.error('Erro ao emitir notificação de sistema:', err.message);
      }
    }
  }

  const monitor = {
    state: 'stopped', // 'stopped' | 'running' | 'waiting' | 'stopping' | 'paused'
    cycle: 0,
    startedAt: null,
    lastCycleAt: null,
    nextRunEstimated: null,
    child: null,
  };

  const recentLogs = [];
  const sseClients = new Set();

  function stripAnsi(text) {
    return text.replace(ANSI_REGEX, '');
  }

  function appendLog(source, text, stream = 'stdout') {
    const entry = {
      at: new Date().toISOString(),
      source,
      stream,
      text: stripAnsi(text),
    };
    recentLogs.push(entry);
    if (recentLogs.length > RECENT_LOGS_LIMIT) {
      recentLogs.shift();
    }
    if (currentJob && source === 'job') {
      currentJob.logs.push(entry);
      if (currentJob.logs.length > MAX_LOGS) {
        currentJob.logs.shift();
      }
    }
    broadcast('log', entry);
    return entry;
  }

  function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(message);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // Envio de heartbeat a cada 20s para manter conexões SSE ativas através de proxies reversos
  const heartbeatTimer = setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    }
  }, 20000);
  heartbeatTimer.unref();

  function getRuntime() {
    return {
      monitor: {
        state: monitor.state,
        cycle: monitor.cycle,
        startedAt: monitor.startedAt,
        lastCycleAt: monitor.lastCycleAt,
        nextRunEstimated: monitor.nextRunEstimated,
      },
      job: currentJob
        ? {
            id: currentJob.id,
            type: currentJob.type,
            label: currentJob.label,
            status: currentJob.status,
            startedAt: currentJob.startedAt,
            confirmation: currentJob.confirmation,
          }
        : lastJob
          ? {
              id: lastJob.id,
              type: lastJob.type,
              label: lastJob.label,
              status: lastJob.status,
              finishedAt: lastJob.finishedAt,
              exitCode: lastJob.exitCode,
            }
          : null,
    };
  }

  function lineProcessor(onLine) {
    let buffer = '';
    return (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        onLine(line);
      }
    };
  }

  // Início do monitor contínuo
  async function startMonitor() {
    if (currentJob) {
      throw httpError(409, `Não é possível iniciar o monitor enquanto um trabalho (${currentJob.label}) está em execução.`);
    }
    if (monitor.state === 'running' || monitor.state === 'waiting') {
      throw httpError(409, 'O monitor contínuo já está em execução.');
    }

    const env = { ...process.env, ...(readEnvFile() || {}) };
    const child = spawn(process.execPath, ['src/monitor.mjs'], {
      cwd: rootDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    monitor.child = child;
    monitor.state = 'running';
    monitor.startedAt = new Date().toISOString();
    monitor.nextRunEstimated = null;
    broadcast('monitor', getRuntime().monitor);

    child.stdout.on(
      'data',
      lineProcessor((line) => {
        appendLog('monitor', line, 'stdout');
        const cleanLine = stripAnsi(line).trim();

        const cycleMatch = cleanLine.match(/Ciclo\s+(\d+)/i);
        if (cycleMatch) {
          monitor.cycle = Number(cycleMatch[1]);
          monitor.state = 'running';
          monitor.nextRunEstimated = null;
          broadcast('monitor', getRuntime().monitor);
        }

        if (cleanLine.includes('Ciclo concluído em')) {
          monitor.lastCycleAt = new Date().toISOString();
        }

        const waitMatch = cleanLine.match(/Próxima varredura em\s+(\d+)s/i);
        if (waitMatch) {
          monitor.state = 'waiting';
          const waitSecs = Number(waitMatch[1]);
          monitor.nextRunEstimated = new Date(Date.now() + waitSecs * 1000).toISOString();
          broadcast('monitor', getRuntime().monitor);
        }
      })
    );

    child.stderr.on(
      'data',
      lineProcessor((line) => {
        appendLog('monitor', line, 'stderr');
      })
    );

    child.on('close', (code, signal) => {
      appendLog('monitor', `Monitor encerrado (código: ${code ?? 'nenhum'}, sinal: ${signal ?? 'nenhum'})`, 'stdout');
      const wasUnexpected = monitor.state !== 'stopping' && monitor.state !== 'paused';
      monitor.child = null;
      if (monitor.state !== 'paused') {
        monitor.state = 'stopped';
        monitor.nextRunEstimated = null;
      }
      broadcast('monitor', getRuntime().monitor);

      if (wasUnexpected) {
        notify({
          type: 'monitor_stopped',
          title: 'Monitor Parado Inesperadamente',
          message: `O monitor contínuo parou inesperadamente (código ${code ?? 'nenhum'}).`,
          severity: 'critical',
          site: 'sistema',
          details: { exitCode: code, signal },
        });
      }
    });

    child.on('error', (err) => {
      appendLog('monitor', `Erro no processo do monitor: ${err.message}`, 'stderr');
      monitor.child = null;
      monitor.state = 'stopped';
      broadcast('monitor', getRuntime().monitor);

      notify({
        type: 'monitor_stopped',
        title: 'Falha no Monitor Contínuo',
        message: `Erro no processo do monitor: ${err.message}`,
        severity: 'critical',
        site: 'sistema',
        details: { error: err.message },
      });
    });

    return getRuntime().monitor;
  }

  // Parada do monitor contínuo
  async function stopMonitor() {
    if (!monitor.child || monitor.state === 'stopped') {
      return getRuntime().monitor;
    }

    monitor.state = 'stopping';
    broadcast('monitor', getRuntime().monitor);

    return new Promise((resolve) => {
      const child = monitor.child;
      if (!child) {
        monitor.state = 'stopped';
        broadcast('monitor', getRuntime().monitor);
        return resolve(getRuntime().monitor);
      }

      let timeout = null;
      const onExit = () => {
        if (timeout) clearTimeout(timeout);
        resolve(getRuntime().monitor);
      };

      child.once('close', onExit);

      try {
        child.kill('SIGINT');
      } catch {
        // Ignora erro se já morreu
      }

      // Se não morrer em 8s, força SIGKILL
      timeout = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 8000);
      timeout.unref();
    });
  }

  // Execução de trabalho ad-hoc (varredura, plano, limpeza ou reset)
  async function runJob(type) {
    const spec = JOB_SPECS[type];
    if (!spec) {
      throw httpError(400, `Tipo de trabalho inválido: ${type}`);
    }

    if (currentJob) {
      throw httpError(409, `Já existe um trabalho em andamento (${currentJob.label}).`);
    }

    // Regra de ouro: se o monitor estiver no meio de um ciclo, bloqueia até o ciclo terminar
    if (monitor.state === 'running') {
      throw httpError(409, `O monitor está executando o ciclo ${monitor.cycle || 1}. Aguarde a conclusão do ciclo para iniciar.`);
    }

    // Se o monitor estiver aguardando o próximo ciclo, pausa-o e retoma ao fim do trabalho
    if (monitor.state === 'waiting' && monitor.child) {
      appendLog('system', 'Pausando monitor contínuo para executar trabalho...', 'stdout');
      resumingMonitorAfterJob = true;
      monitor.state = 'paused';
      broadcast('monitor', getRuntime().monitor);
      await new Promise((resolve) => {
        const child = monitor.child;
        if (!child) return resolve();
        child.once('close', resolve);
        child.kill('SIGINT');
      });
    }

    const env = { ...process.env, ...(readEnvFile() || {}) };
    const child = spawn(process.execPath, spec.args, {
      cwd: rootDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const job = {
      id: `job-${Date.now()}-${type}`,
      type,
      label: spec.label,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      error: null,
      confirmation: null,
      logs: [],
      child,
    };

    currentJob = job;
    broadcast('job', getRuntime().job);
    appendLog('job', `Iniciando trabalho: ${spec.label}`, 'stdout');

    child.stdout.on(
      'data',
      lineProcessor((line) => {
        appendLog('job', line, 'stdout');
        const cleanLine = stripAnsi(line).trim();

        // Detecta pedido de confirmação interativa do clean.mjs:
        // "Para executar X ação(ões), digite exatamente LIMPAR-XXXXX: "
        const confirmMatch = cleanLine.match(/Para executar (\d+) ação\(ões\), digite exatamente (LIMPAR-[A-F0-9]+):/i);
        if (confirmMatch && type === 'clean') {
          job.status = 'waiting_confirmation';
          job.confirmation = {
            actionCount: Number(confirmMatch[1]),
            code: confirmMatch[2],
            prompt: cleanLine,
          };
          broadcast('job', getRuntime().job);

          notify({
            type: 'clean_waiting_confirmation',
            title: 'Limpeza Aguarda Confirmação',
            message: `O plano de limpeza exige confirmação (${confirmMatch[1]} ação(ões) prontas).`,
            severity: 'high',
            site: 'sistema',
            link: 'cleanup',
            details: { code: confirmMatch[2], actionCount: Number(confirmMatch[1]) },
          });
        }
      })
    );

    child.stderr.on(
      'data',
      lineProcessor((line) => {
        appendLog('job', line, 'stderr');
      })
    );

    child.on('close', (code) => {
      job.finishedAt = new Date().toISOString();
      job.exitCode = code;
      if (job.status === 'waiting_confirmation') {
        job.status = 'cancelled';
      } else if (job.status !== 'cancelled') {
        job.status = code === 0 ? 'completed' : 'failed';
      }

      appendLog('job', `Trabalho ${job.label} finalizado com status ${job.status} (código ${code})`, 'stdout');
      lastJob = { ...job, child: null };
      currentJob = null;
      broadcast('job', getRuntime().job);

      if (job.status === 'completed') {
        notify({
          type: 'job_completed',
          title: 'Trabalho Concluído',
          message: `${job.label} concluído com sucesso.`,
          severity: 'info',
          site: 'sistema',
          details: { type: job.type, exitCode: code },
        });
      } else if (job.status === 'failed') {
        notify({
          type: 'job_failed',
          title: 'Falha no Trabalho',
          message: `${job.label} falhou (código de saída ${code}).`,
          severity: 'high',
          site: 'sistema',
          details: { type: job.type, exitCode: code },
        });
      }

      // Retomada automática do monitor se ele foi pausado
      if (resumingMonitorAfterJob) {
        resumingMonitorAfterJob = false;
        appendLog('system', 'Retomando monitor contínuo...', 'stdout');
        setTimeout(() => {
          startMonitor().catch((err) => {
            appendLog('system', `Falha ao retomar monitor: ${err.message}`, 'stderr');
          });
        }, 1500).unref();
      }
    });

    child.on('error', (err) => {
      job.finishedAt = new Date().toISOString();
      job.status = 'failed';
      job.error = err.message;
      appendLog('job', `Erro ao executar ${job.label}: ${err.message}`, 'stderr');
      lastJob = { ...job, child: null };
      currentJob = null;
      broadcast('job', getRuntime().job);

      notify({
        type: 'job_failed',
        title: 'Erro ao Iniciar Trabalho',
        message: `Falha ao executar ${job.label}: ${err.message}`,
        severity: 'high',
        site: 'sistema',
        details: { type: job.type, error: err.message },
      });

      if (resumingMonitorAfterJob) {
        resumingMonitorAfterJob = false;
        setTimeout(() => startMonitor().catch(() => {}), 1500).unref();
      }
    });

    return getRuntime().job;
  }

  // Confirmar limpeza enviando a frase exigida para o stdin do processo
  function confirmClean(code) {
    if (!currentJob || currentJob.type !== 'clean' || currentJob.status !== 'waiting_confirmation') {
      throw httpError(400, 'Nenhuma limpeza aguardando confirmação no momento.');
    }
    const expected = currentJob.confirmation?.code;
    const provided = String(code || '').trim();
    if (provided !== expected) {
      throw httpError(400, `Código de confirmação incorreto. Esperado: "${expected}".`);
    }

    currentJob.status = 'running';
    currentJob.confirmation = null;
    broadcast('job', getRuntime().job);

    appendLog('job', `Confirmação recebida (${provided}). Executando ações...`, 'stdout');
    currentJob.child.stdin.write(`${provided}\n`);
    return { ok: true, message: 'Confirmação enviada' };
  }

  // Cancelar limpeza enviando entrada incorreta/cancelar para o stdin
  function cancelClean() {
    if (!currentJob || currentJob.type !== 'clean' || currentJob.status !== 'waiting_confirmation') {
      throw httpError(400, 'Nenhuma limpeza aguardando confirmação no momento.');
    }

    currentJob.status = 'cancelled';
    currentJob.confirmation = null;
    broadcast('job', getRuntime().job);

    appendLog('job', 'Limpeza cancelada pelo usuário.', 'stdout');
    // clean.mjs ao receber texto diferente da frase esperada cancela e grava o relatório 'cancelada'
    currentJob.child.stdin.write('CANCELAR\n');
    return { ok: true, message: 'Limpeza cancelada' };
  }

  // Roteador SSE para /api/events
  function sseHandler(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Envia estado inicial e logs recentes
    const initData = {
      ...getRuntime(),
      recentLogs: recentLogs.slice(-100),
    };
    res.write(`event: init\ndata: ${JSON.stringify(initData)}\n\n`);

    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
  }

  // Início automático do monitor se MONITOR_AUTOSTART=true
  const env = { ...process.env, ...(readEnvFile() || {}) };
  if (String(env.MONITOR_AUTOSTART).toLowerCase() === 'true' || env.MONITOR_AUTOSTART === '1') {
    setTimeout(() => {
      startMonitor().catch((err) => {
        appendLog('system', `Falha no início automático do monitor: ${err.message}`, 'stderr');
      });
    }, 1000).unref();
  }

  return {
    getRuntime,
    startMonitor,
    stopMonitor,
    runJob,
    confirmClean,
    cancelClean,
    sseHandler,
    broadcast,
    setNotificationHandler: (fn) => {
      notificationHandler = fn;
    },
    getRecentLogs: () => recentLogs.slice(),
    getCurrentJobDetails: () => (currentJob ? { ...currentJob, child: undefined } : (lastJob ? { ...lastJob, child: undefined } : null)),
  };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
