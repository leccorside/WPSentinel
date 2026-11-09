// Rotas de controle de processos (Passo 4): disparar trabalhos, confirmação da limpeza, monitor e SSE.
import express from 'express';
import { loadSites } from '../src/config.mjs';
import { readEnvFile } from './config.mjs';

export function createOrchestratorRouter({ orchestrator, dataDir }) {
  const router = express.Router();
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

  // Eventos ao vivo por SSE (Server-Sent Events)
  router.get('/events', (req, res) => {
    orchestrator.sseHandler(req, res);
  });

  // Disparo de trabalho (scan, scan_full, plan, clean, reset_baseline)
  // site (opcional): chave de um site cadastrado; vazio ou "all" = todos.
  router.post('/jobs/run', route(async (req, res) => {
    const { type } = req.body || {};
    const requested = String(req.body?.site || '').trim();
    let site = null;
    let siteName = null;
    if (requested && requested !== 'all') {
      const found = loadSites(readEnvFile() || {}, dataDir).find((candidate) => candidate.key === requested);
      if (!found) throw Object.assign(new Error(`Site não cadastrado: ${requested}`), { status: 400 });
      site = found.key;
      siteName = found.name;
    }
    const job = await orchestrator.runJob(type, { site, siteName });
    res.json({ ok: true, job });
  }));

  // Detalhes do trabalho atual ou último finalizado, incluindo logs
  router.get('/jobs/current', route(async (req, res) => {
    res.json({ job: orchestrator.getCurrentJobDetails() });
  }));

  // Confirmação da limpeza interativa (clean.mjs)
  router.post('/jobs/clean/confirm', route(async (req, res) => {
    const code = req.body?.code || req.body?.phrase || req.body?.confirmation;
    const result = orchestrator.confirmClean(code);
    res.json(result);
  }));

  // Cancela o trabalho em andamento (varredura, plano; limpeza só enquanto espera a confirmação)
  router.post('/jobs/cancel', route(async (req, res) => {
    res.json(orchestrator.cancelJob());
  }));

  // Cancelamento da limpeza interativa
  router.post('/jobs/clean/cancel', route(async (req, res) => {
    const result = orchestrator.cancelClean();
    res.json(result);
  }));

  // Iniciar monitor contínuo
  router.post('/monitor/start', route(async (req, res) => {
    const monitor = await orchestrator.startMonitor();
    res.json({ ok: true, monitor });
  }));

  // Parar monitor contínuo
  router.post('/monitor/stop', route(async (req, res) => {
    const monitor = await orchestrator.stopMonitor();
    res.json({ ok: true, monitor });
  }));

  return router;
}
