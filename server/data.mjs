// Leitura dos arquivos gravados pelo motor (.monitor-data e reports). Só leitura: nada aqui altera dados.
import fs from 'node:fs/promises';
import path from 'node:path';

// state.json e trusted-baseline.json passam de 3 MB: cada arquivo é relido só quando muda (mtime + tamanho).
const cache = new Map();

async function cached(file, parse) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { value: null, modifiedAt: null };
    throw error;
  }
  const signature = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(file);
  if (hit?.signature === signature) return hit.result;
  const result = { value: parse(await fs.readFile(file, 'utf8')), modifiedAt: stat.mtime.toISOString() };
  cache.set(file, { signature, result });
  return result;
}

const readJson = (file) => cached(file, (text) => JSON.parse(text));
const readJsonLines = (file) => cached(file, (text) => text.split(/\r?\n/).filter(Boolean).map((line, index) => {
  try { return { ...JSON.parse(line), id: index }; } catch { return { id: index, severity: 'info', site: 'monitor', message: 'Linha inválida em alerts.jsonl', details: {} }; }
}));

export const readState = (dataDir) => readJson(path.join(dataDir, 'state.json'));
export const readBaseline = (dataDir) => readJson(path.join(dataDir, 'trusted-baseline.json'));
export const readPlan = (dataDir) => readJson(path.join(dataDir, 'last-cleanup-plan.json'));

// Alertas com a mesma regra da limpeza: "pendente" = depois do último cleanup_completed.
export async function readAlerts(dataDir) {
  const { value, modifiedAt } = await readJsonLines(path.join(dataDir, 'alerts.jsonl'));
  const alerts = value || [];
  const lastCleanupIndex = alerts.findLastIndex((event) => event.message === 'cleanup_completed');
  return { alerts, lastCleanupIndex, lastCleanup: alerts[lastCleanupIndex] || null, modifiedAt };
}

export const isPendingAlert = (alert, lastCleanupIndex) =>
  alert.id > lastCleanupIndex && (alert.severity === 'critical' || alert.severity === 'high');

// ---------------------------------------------------------------------------------------------------------------
// Integridade: estado atual comparado com a baseline confiável, arquivo por arquivo.

export const FILE_STATUSES = ['trusted', 'changed', 'new', 'removed', 'unhashed'];

export function compareFiles(currentFiles = {}, trustedFiles = {}) {
  const rows = [];
  for (const [rel, current] of Object.entries(currentFiles)) {
    const trusted = trustedFiles[rel];
    let status;
    if (!current.hash) status = 'unhashed';
    else if (!trusted) status = 'new';
    else status = trusted.hash === current.hash ? 'trusted' : 'changed';
    rows.push({ path: rel, status, size: current.size, modifiedAt: toIso(current.mtime), hash: current.hash, baselineHash: trusted?.hash || null });
  }
  for (const [rel, trusted] of Object.entries(trustedFiles)) {
    if (!currentFiles[rel]) rows.push({ path: rel, status: 'removed', size: trusted.size, modifiedAt: toIso(trusted.mtime), hash: null, baselineHash: trusted.hash || null });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function countByStatus(rows) {
  const counts = Object.fromEntries(FILE_STATUSES.map((status) => [status, 0]));
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

// O malware carrega drop-ins em toda requisição; o painel mostra quais existem em cada site.
const DROPIN_PATTERN = /^wp-content\/(?:db|advanced-cache|object-cache)\.php$|^wp-content\/cache\/[^/]+\.php$/i;

// ---------------------------------------------------------------------------------------------------------------
// Resumo de um site para a Visão Geral, só com o que o último ciclo gravou.

export function summarizeSite(site, siteState, siteBaseline) {
  if (!siteState) return { key: site.key, name: site.name, url: site.url, scanned: false };
  const http = siteState.lastHttp || {};
  const db = siteState.database;
  const users = siteState.users || [];
  const files = siteState.files || {};
  const paths = Object.keys(files);
  return {
    key: site.key,
    name: site.name,
    url: site.url,
    scanned: true,
    scannedAt: siteState.scannedAt || null,
    files: {
      monitored: paths.length,
      unreadable: siteState.unreadable || [],
      muPlugins: paths.filter((rel) => rel.startsWith('wp-content/mu-plugins/')),
      dropins: paths.filter((rel) => DROPIN_PATTERN.test(rel)),
      integrity: countByStatus(compareFiles(files, siteBaseline?.files)),
    },
    http: {
      homeStatus: http.homeStatus ?? null,
      finalUrl: http.finalUrl || null,
      xmlrpcStatus: http.xmlrpcStatus ?? null,
      uploadProbeStatus: http.uploadProbeStatus ?? null,
      homeOk: http.homeStatus >= 200 && http.homeStatus < 400,
      xmlrpcBlocked: http.xmlrpcStatus === 403,
      uploadsPhpBlocked: http.uploadProbeStatus === 403,
    },
    database: db
      ? {
        checked: true,
        checkedAt: db.checkedAt || null,
        users: users.map((user) => ({ id: user.id, login: user.login, roles: roles(user.capabilities), registered: user.registered })),
        admins: users.filter((user) => roles(user.capabilities).includes('administrator')).length,
        sessions: (db.sessionIds || []).length,
        sessionUsers: db.sessionRows ?? 0,
        applicationPasswords: db.applicationPasswordRows ?? 0,
        publicRegistration: db.usersCanRegister === '1',
        siteurl: db.siteurl || null,
        home: db.home || null,
        cronHooks: (db.cronHooks || []).length,
        posts: (db.postIds || []).length,
      }
      : { checked: false },
  };
}

// wp_capabilities é um array PHP serializado (ex.: a:1:{s:13:"administrator";b:1;}).
function roles(capabilities = '') {
  return [...String(capabilities).matchAll(/s:\d+:"([^"]+)";b:1;/g)].map((match) => match[1]);
}

function toIso(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------------------------------------------
// Backups da limpeza: <PLANO>-<site>-<tipo>.json e <PLANO>-<site>-arquivos/ (cópia dos arquivos apagados).

const BACKUP_NAME = /^([0-9A-F]{10})-([a-z0-9_-]+?)-([a-z-]+)(\.json)?$/;

export async function listBackups(dataDir, alerts) {
  const dir = path.join(dataDir, 'backups');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { plans: [], others: [] };
    throw error;
  }
  const cleanupAt = new Map(alerts.filter((a) => a.message === 'cleanup_completed').map((a) => [a.details?.planId, a.timestamp]));
  const plans = new Map();
  const others = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const { bytes, files, modifiedAt } = await measure(full, entry.isDirectory());
    const item = { name: entry.name, directory: entry.isDirectory(), bytes, files, modifiedAt };
    const match = entry.name.match(BACKUP_NAME);
    if (!match) { others.push(item); continue; }
    const [, planId, site, kind] = match;
    if (!plans.has(planId)) plans.set(planId, { planId, executedAt: cleanupAt.get(planId) || null, items: [] });
    plans.get(planId).items.push({ ...item, site, kind });
  }
  const sorted = [...plans.values()].map((plan) => ({
    ...plan,
    bytes: plan.items.reduce((sum, item) => sum + item.bytes, 0),
    lastModifiedAt: plan.items.map((item) => item.modifiedAt).sort().at(-1),
  })).sort((a, b) => String(b.executedAt || b.lastModifiedAt).localeCompare(String(a.executedAt || a.lastModifiedAt)));
  return { plans: sorted, others: others.sort((a, b) => a.name.localeCompare(b.name)) };
}

async function measure(target, isDirectory) {
  const stat = await fs.stat(target);
  if (!isDirectory) return { bytes: stat.size, files: 1, modifiedAt: stat.mtime.toISOString() };
  let bytes = 0;
  let files = 0;
  for (const entry of await fs.readdir(target, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += (await fs.stat(path.join(entry.parentPath ?? entry.path, entry.name))).size;
  }
  return { bytes, files, modifiedAt: stat.mtime.toISOString() };
}

// ---------------------------------------------------------------------------------------------------------------
// Relatórios diários (reports/REPORT-DD.MM.AA.txt).

export const REPORT_NAME = /^REPORT-(\d{2})\.(\d{2})\.(\d{2})\.txt$/;

export async function listReports(reportsDir) {
  let names;
  try {
    names = await fs.readdir(reportsDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const reports = [];
  for (const name of names) {
    const match = name.match(REPORT_NAME);
    if (!match) continue;
    const stat = await fs.stat(path.join(reportsDir, name));
    const [, day, month, year] = match;
    const text = await fs.readFile(path.join(reportsDir, name), 'utf8');
    reports.push({ name, date: `20${year}-${month}-${day}`, bytes: stat.size, modifiedAt: stat.mtime.toISOString(), sections: parseReport(text).sections.length });
  }
  return reports.sort((a, b) => b.date.localeCompare(a.date));
}

// Seções no formato de report.mjs: linha de traços, "N. TÍTULO", linha de traços e o corpo.
export function parseReport(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const isRule = (line) => /^-{10,}\s*$/.test(line || '');
  const sections = [];
  let header = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index].match(/^(\d+)\.\s+(.+)$/);
    if (title && isRule(lines[index - 1]) && isRule(lines[index + 1])) {
      if (current) sections.push(current);
      current = { number: Number(title[1]), title: title[2].trim(), body: [] };
      index += 1;
      continue;
    }
    if (current) {
      if (!(isRule(lines[index]) && lines[index + 1]?.match(/^\d+\.\s+/))) current.body.push(lines[index]);
    } else {
      header.push(lines[index]);
    }
  }
  if (current) sections.push(current);
  header = header.join('\n').trim();
  return {
    header,
    sections: sections.map((section) => {
      const body = section.body.join('\n').trim();
      const result = body.match(/^RESULTADO:\s*(.+)$/m)?.[1]?.trim() || null;
      return { number: section.number, title: section.title, kind: sectionKind(section.title), result, severity: resultSeverity(result), body };
    }),
  };
}

function sectionKind(title) {
  if (/^LIMPEZA/i.test(title)) return 'cleanup';
  if (/^VARREDURA/i.test(title)) return 'scan';
  if (/^MONITOR/i.test(title)) return 'monitor';
  return 'other';
}

// "N ALERTA(S) CRÍTICO(S) E M ALTO(S)" aparece mesmo com N = 0: a severidade vem dos números.
function resultSeverity(result) {
  if (!result) return null;
  const counts = result.match(/(\d+)\s+ALERTA\(S\)\s+CR[IÍ]TICO\(S\)\s+E\s+(\d+)\s+ALTO/i);
  if (counts) return Number(counts[1]) ? 'critical' : Number(counts[2]) ? 'high' : 'ok';
  if (/INTERROMPIDA|ERRO/i.test(result)) return 'critical';
  if (/CANCELADA/i.test(result)) return 'high';
  return 'ok';
}
