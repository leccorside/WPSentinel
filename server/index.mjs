#!/usr/bin/env node
// Servidor do painel web: API em /api e os arquivos do front (web/dist).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import { createAuthManager } from './auth.mjs';
import { createOrchestrator } from './orchestrator.mjs';
import { createOrchestratorRouter } from './api-orchestrator.mjs';
import { createReadRouter } from './api-read.mjs';
import { ENV_FILE, ROOT_DIR, WEB_DIR, isLoopback, panelSettings, readEnvFile } from './config.mjs';

const startedAt = new Date();
const settings = panelSettings();

// Trava de segurança: exposto fora da máquina (ex.: VPS) só com senha.
if (!isLoopback(settings.host) && !settings.password) {
  console.error(`PANEL_HOST=${settings.host} expõe o painel fora desta máquina. Defina PANEL_PASSWORD no .env ou use PANEL_HOST=127.0.0.1.`);
  process.exit(1);
}

const auth = createAuthManager(settings);
const orchestrator = createOrchestrator({ rootDir: ROOT_DIR });

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(auth.authMiddleware);

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    panel: { host: settings.host, port: settings.port, login: Boolean(settings.password) },
    env: describeEnv(),
    data: await describeData(settings.paths.dataDir),
    reports: await describeReports(settings.paths.reportsDir),
  });
});

app.use('/api/auth', auth.authRouter);
app.use('/api', createOrchestratorRouter({ orchestrator }));
app.use('/api', createReadRouter({ paths: settings.paths, getRuntime: orchestrator.getRuntime }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// Front (SPA): arquivos estáticos e index.html para qualquer outra rota.
if (existsSync(WEB_DIR)) {
  app.use(express.static(WEB_DIR, { index: false }));
  app.get('*', (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));
} else {
  app.get('*', (req, res) => res.status(503).send('Front-end não compilado (web/dist ausente).'));
}

const server = app.listen(settings.port, settings.listen, () => {
  console.log(`WP Sentinel — painel em http://${settings.host}:${settings.port} (escutando em ${settings.listen}:${settings.port})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`${signal} recebido; encerrando o painel e processos filhos.`);
    await orchestrator.stopMonitor();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

// Nunca devolve valores do .env, só se ele existe e quais sites define.
function describeEnv() {
  const envFile = readEnvFile();
  if (!envFile) return { found: false, file: ENV_FILE };
  try {
    return { found: true, sites: loadSites(envFile).map((site) => ({ key: site.key, name: site.name, url: site.url, db: site.db.enabled })) };
  } catch (error) {
    return { found: true, error: error.message };
  }
}

async function describeData(dataDir) {
  const result = { dir: dataDir, writable: false, state: null, baseline: null };
  try {
    await fs.access(dataDir, fs.constants.W_OK);
    result.writable = true;
  } catch {
    // Sem permissão de escrita: o monitor não conseguiria gravar o estado.
  }
  result.state = await describeJson(path.join(dataDir, 'state.json'));
  result.baseline = await describeJson(path.join(dataDir, 'trusted-baseline.json'));
  return result;
}

// O state.json passa de 3 MB: só o começo é lido, onde ficam "cycle" e "createdAt".
async function describeJson(file) {
  try {
    const handle = await fs.open(file);
    try {
      const { buffer, bytesRead } = await handle.read({ buffer: Buffer.alloc(512), position: 0 });
      const head = buffer.toString('utf8', 0, bytesRead);
      const stat = await handle.stat();
      return {
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        cycle: Number(head.match(/"cycle":\s*(\d+)/)?.[1] ?? NaN) || null,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return error.code === 'ENOENT' ? null : { error: error.message };
  }
}

async function describeReports(reportsDir) {
  try {
    const files = (await fs.readdir(reportsDir)).filter((name) => /^REPORT-.*\.txt$/.test(name)).sort();
    return { dir: reportsDir, files: files.length, latest: files.at(-1) || null };
  } catch (error) {
    return { dir: reportsDir, files: 0, error: error.code === 'ENOENT' ? 'pasta ausente' : error.message };
  }
}
