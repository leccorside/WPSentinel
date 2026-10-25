// Rotas de leitura do painel (Passo 3). Nenhuma delas altera dados nem acessa os sites.
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { loadSites } from '../src/config.mjs';
import { readEnvFile } from './config.mjs';
import { makeItemKey } from './api-features.mjs';
import {
  FILE_STATUSES, REPORT_NAME, compareFiles, countByStatus, isPendingAlert, listBackups, listReports, parseReport,
  readAlerts, readBaseline, readPlan, readState, summarizeSite,
} from './data.mjs';

// getRuntime: estado do monitor e do trabalho em andamento (preenchido pelo Passo 4).
export function createReadRouter({ paths, getRuntime = () => ({ monitor: { state: 'stopped' }, job: null }) }) {
  const router = express.Router();
  const { dataDir, reportsDir } = paths;
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

  router.get('/status', route(async (req, res) => {
    const [{ value: state }, { alerts, lastCleanupIndex, lastCleanup }] = await Promise.all([readState(dataDir), readAlerts(dataDir)]);
    const pending = alerts.filter((alert) => isPendingAlert(alert, lastCleanupIndex));
    res.json({
      now: new Date().toISOString(),
      ...getRuntime(),
      lastCycle: state ? { cycle: state.cycle ?? null, updatedAt: state.updatedAt || null } : null,
      pendingAlerts: { critical: pending.filter((a) => a.severity === 'critical').length, high: pending.filter((a) => a.severity === 'high').length },
      lastCleanup: lastCleanup ? { at: lastCleanup.timestamp, planId: lastCleanup.details?.planId || null } : null,
      sites: sites().map(({ key, name, url }) => ({ key, name, url })),
    });
  }));

  router.get('/overview', route(async (req, res) => {
    const env = readEnvFile() || {};
    const [{ value: state }, { value: baseline }, { alerts, lastCleanupIndex }] = await Promise.all([readState(dataDir), readBaseline(dataDir), readAlerts(dataDir)]);
    const summaries = sites(env).map((site) => summarizeSite(site, state?.sites?.[site.key], baseline?.sites?.[site.key]));
    const pending = alerts.filter((alert) => isPendingAlert(alert, lastCleanupIndex));
    const interval = Math.max(30, Number(env.INTERVAL_SECONDS || 300));
    const fullHashEvery = Math.max(1, Number(env.FULL_HASH_EVERY || 24));
    const cycle = Number(state?.cycle || 0);
    res.json({
      cycle,
      updatedAt: state?.updatedAt || null,
      baselineTrustedAt: baseline?.trustedAt || null,
      settings: { intervalSeconds: interval, fullHashEvery, nextFullHashCycle: (Math.floor(cycle / fullHashEvery) + 1) * fullHashEvery },
      totals: {
        filesMonitored: summaries.reduce((sum, s) => sum + (s.files?.monitored || 0), 0),
        sessions: summaries.reduce((sum, s) => sum + (s.database?.sessions || 0), 0),
        pending: {
          critical: pending.filter((a) => a.severity === 'critical').length,
          high: pending.filter((a) => a.severity === 'high').length,
          hiddenLinks: pending.filter((a) => /Links externos ocultos/.test(a.message)).length,
          malwareMarkers: pending.filter((a) => /Marcador/i.test(a.message)).length,
          suspiciousSessions: pending.filter((a) => a.message === 'Sessão de login suspeita').length,
        },
      },
      sites: summaries,
    });
  }));

  router.get('/alerts', route(async (req, res) => {
    const { alerts, lastCleanupIndex } = await readAlerts(dataDir);
    const names = new Map(sites().map((site) => [site.key, site.name]));
    const severities = list(req.query.severity);
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = alerts.filter((alert) =>
      (!req.query.site || alert.site === req.query.site)
      && (!severities.length || severities.includes(alert.severity))
      && (req.query.pending !== '1' || isPendingAlert(alert, lastCleanupIndex))
      && (!q || `${alert.message} ${alertContext(alert.details)}`.toLowerCase().includes(q)));
    const { offset, limit } = page(req.query, 50, 500);
    res.json({
      total: filtered.length,
      offset,
      limit,
      lastCleanupId: lastCleanupIndex >= 0 ? lastCleanupIndex : null,
      counts: Object.fromEntries(['critical', 'high', 'info'].map((s) => [s, filtered.filter((a) => a.severity === s).length])),
      items: filtered.slice().reverse().slice(offset, offset + limit).map((alert) => ({
        ...alert,
        siteName: names.get(alert.site) || (alert.site === 'monitor' ? 'Monitor' : alert.site),
        pending: isPendingAlert(alert, lastCleanupIndex),
        afterLastCleanup: alert.id > lastCleanupIndex,
        context: alertContext(alert.details),
      })),
    });
  }));

  router.get('/files', route(async (req, res) => {
    const isAll = !req.query.site || req.query.site === 'all';
    const targetSites = isAll ? sites() : [requireSite(req.query.site)];
    const [{ value: state }, { value: baseline }] = await Promise.all([readState(dataDir), readBaseline(dataDir)]);

    let rows = [];
    let latestScannedAt = null;

    for (const site of targetSites) {
      const siteRows = compareFiles(state?.sites?.[site.key]?.files, baseline?.sites?.[site.key]?.files);
      const siteScannedAt = state?.sites?.[site.key]?.scannedAt || null;
      if (siteScannedAt && (!latestScannedAt || new Date(siteScannedAt) > new Date(latestScannedAt))) {
        latestScannedAt = siteScannedAt;
      }
      for (const row of siteRows) {
        rows.push({
          ...row,
          siteKey: site.key,
          siteName: site.name,
        });
      }
    }

    const statuses = list(req.query.status).filter((s) => FILE_STATUSES.includes(s));
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = rows.filter((row) =>
      (!statuses.length || statuses.includes(row.status))
      && (!q || row.path.toLowerCase().includes(q) || row.hash?.startsWith(q) || (row.siteName && row.siteName.toLowerCase().includes(q)))
    );
    const { offset, limit } = page(req.query, 50, 500);

    res.json({
      site: isAll ? 'all' : targetSites[0].key,
      siteName: isAll ? `Todos os Sites (${targetSites.length})` : targetSites[0].name,
      baselineTrustedAt: baseline?.trustedAt || null,
      scannedAt: latestScannedAt,
      counts: countByStatus(rows),
      total: filtered.length,
      offset,
      limit,
      items: filtered.slice(offset, offset + limit),
    });
  }));

  // Download do que difere da baseline (alterados, novos, removidos e sem hash), por site ou de todos.
  router.get('/baseline-diff', route(async (req, res) => {
    const isAll = !req.query.site || req.query.site === 'all';
    const selected = isAll ? sites() : [requireSite(req.query.site)];
    const [{ value: state }, { value: baseline }] = await Promise.all([readState(dataDir), readBaseline(dataDir)]);
    const diff = {
      generatedAt: new Date().toISOString(),
      baselineTrustedAt: baseline?.trustedAt || null,
      stateUpdatedAt: state?.updatedAt || null,
      cycle: state?.cycle ?? null,
      sites: {},
    };
    for (const site of selected) {
      const rows = compareFiles(state?.sites?.[site.key]?.files, baseline?.sites?.[site.key]?.files);
      diff.sites[site.key] = { name: site.name, counts: countByStatus(rows), differences: rows.filter((row) => row.status !== 'trusted') };
    }
    const stamp = diff.generatedAt.slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="baseline-diff-${req.query.site || 'todos'}-${stamp}.json"`);
    res.json(diff);
  }));

  router.get('/plan', route(async (req, res) => {
    const { value: plan, modifiedAt } = await readPlan(dataDir);
    if (!plan) return res.json({ plan: null });
    let reviewedMap = {};
    try {
      reviewedMap = JSON.parse(await fs.readFile(path.join(dataDir, 'reviewed-items.json'), 'utf8'));
    } catch {}
    const manualReview = (plan.manualReview || []).map((item) => {
      const key = makeItemKey(item);
      return { ...item, key, reviewed: Boolean(reviewedMap[key]) };
    });
    const actions = [...(plan.fileActions || []), ...(plan.databaseActions || [])];
    const byType = {};
    for (const action of actions) byType[action.type] = (byType[action.type] || 0) + 1;
    res.json({
      plan: { ...plan, manualReview },
      savedAt: modifiedAt,
      summary: {
        actions: actions.length,
        manualReview: manualReview.length,
        reviewedManualReview: manualReview.filter((m) => m.reviewed).length,
        byType,
      },
    });
  }));

  router.get('/backups', route(async (req, res) => {
    const { alerts } = await readAlerts(dataDir);
    res.json(await listBackups(dataDir, alerts));
  }));

  router.get('/reports', route(async (req, res) => {
    res.json({ reports: await listReports(reportsDir) });
  }));

  router.get('/reports/:name', route(async (req, res) => {
    const text = await readReport(req.params.name);
    res.json({ name: req.params.name, ...parseReport(text), text });
  }));

  router.get('/reports/:name/raw', route(async (req, res) => {
    const text = await readReport(req.params.name);
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
    res.type('text/plain; charset=utf-8').send(text);
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.message });
  });

  return router;

  function sites(env = readEnvFile() || {}) {
    return loadSites(env, dataDir);
  }

  function requireSite(key) {
    const site = sites().find((candidate) => candidate.key === key);
    if (!site) throw httpError(400, `Site desconhecido: ${key || '(vazio)'}`);
    return site;
  }

  // Só nomes REPORT-DD.MM.AA.txt: o nome nunca vira caminho arbitrário.
  async function readReport(name) {
    if (!REPORT_NAME.test(name)) throw httpError(400, 'Nome de relatório inválido');
    try {
      return await fs.readFile(path.join(reportsDir, name), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw httpError(404, 'Relatório não encontrado');
      throw error;
    }
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function list(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function page(query, fallback, max) {
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const limit = Math.min(max, Math.max(1, Number.parseInt(query.limit, 10) || fallback));
  return { offset, limit };
}

// Mesmo resumo de contexto que o monitor usa no console e nos relatórios.
function alertContext(details = {}) {
  return details.path || [
    details.titulo && `"${details.titulo}"`, details.visto_como && `visto como ${details.visto_como}`,
    details.dominios && details.dominios.join(', '), details.pasta && `${details.pasta}: ${details.quantidade} arquivo(s)`,
    details.login && `${details.login} (${details.ip || 'IP desconhecido'})`, details.hook, details.error,
  ].filter(Boolean).join(' — ');
}
