#!/usr/bin/env node

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import SftpClient from 'ssh2-sftp-client';
import mysql from 'mysql2/promise';
import { findHiddenBlocks, scanElementorData } from './hidden-links.mjs';
import { lookupServerIps, parseSessions, suspiciousReasons } from './sessions.mjs';
import { MARKER_DIRS, isMalwareMarker } from './malware-markers.mjs';
import { assertSftp, loadSites, sftpKey } from './config.mjs';
import { classifyPhp, isCacheRootPhp, isDropin } from './dropins.mjs';
import { appendSection, bullet, dateBR, number, timeBR } from './report.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const DATA_DIR = path.join(ROOT_DIR, '.monitor-data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const BASELINE_FILE = path.join(DATA_DIR, 'trusted-baseline.json');
const ALERT_FILE = path.join(DATA_DIR, 'alerts.jsonl');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');

const ONCE = process.argv.includes('--once');
const RESET_BASELINE = process.argv.includes('--reset-baseline');
// Força o hash completo em todos os ciclos desta execução (botão "Revalidar Hashes" do painel).
const FORCE_FULL_HASH = process.argv.includes('--full-hash');
const INTERVAL_MS = Math.max(30, Number(process.env.INTERVAL_SECONDS || 300)) * 1000;
const FULL_HASH_EVERY = Math.max(1, Number(process.env.FULL_HASH_EVERY || 24));
const MAX_DOWNLOAD_BYTES = Math.max(1024, Number(process.env.MAX_DOWNLOAD_BYTES || 8 * 1024 * 1024));

// Sites, caminhos, bancos e acessos vêm do .env (ver src/config.mjs).
const sites = loadSites();

const monitoredExtensions = new Set([
  '.php', '.php3', '.php4', '.php5', '.php7', '.php8', '.phtml', '.phar', '.phps',
  '.js', '.html', '.htm', '.htaccess', '.ini',
]);

const contentRules = [
  ['critical', 'webshell conhecido', /\b(?:FilesMan|WSO(?:\s|_)*Shell|b374k|alfa[ _-]?shell|c99shell|r57shell)\b/i],
  ['critical', 'execução de carga codificada', /eval\s*\(\s*(?:base64_decode|gzinflate|gzuncompress|str_rot13)\s*\(/i],
  ['critical', 'comando do sistema vindo da requisição', /(?:shell_exec|passthru|proc_open|popen|system|exec)\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/i],
  ['critical', 'assert controlado pela requisição', /assert\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/i],
  ['high', 'include controlado pela requisição', /(?:include|require)(?:_once)?\s*\(?\s*\$_(?:GET|POST|REQUEST|COOKIE)/i],
];

// Declarado antes do laço principal: o ciclo roda em top-level await e usaria o cache antes da inicialização.
const serverIpCache = new Map();
// Alertas e resumo de cada site no ciclo atual, usados no relatório diário (reports/REPORT-DD.MM.AA.txt).
let cycleAlerts = [];
let cycleSites = new Map();

let state = await loadState();
let cycle = Number(state.cycle || 0);
let stopping = false;

process.on('SIGINT', () => {
  stopping = true;
  console.log('\nEncerrando após o ciclo atual...');
});

await fs.mkdir(DATA_DIR, { recursive: true });
if (RESET_BASELINE) {
  state = { version: 1, createdAt: new Date().toISOString(), cycle: 0, sites: {} };
  console.log('Baseline anterior descartada. Uma nova será criada nesta execução.');
}

do {
  const startedAt = new Date();
  const result = await runCycle().catch(async (error) => {
    await emitAlert('critical', 'monitor', 'Falha geral da varredura', { error: error.message });
    return { high: 0, critical: 1 };
  });

  const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
  console.log(`Ciclo concluído em ${seconds}s: ${result.high} alto(s), ${result.critical} crítico(s).`);

  // Relatório: a varredura (--once) sempre grava; o monitor contínuo só grava ciclos com alertas.
  if (ONCE || result.high || result.critical) {
    try {
      const file = await writeScanReport(startedAt, seconds, result);
      console.log(`Relatório: ${path.relative(ROOT_DIR, file)}`);
    } catch (error) {
      console.warn(`Relatório não gravado: ${error.message}`);
    }
  }

  if (ONCE) {
    process.exitCode = result.critical ? 2 : result.high ? 1 : 0;
    break;
  }

  if (!stopping) {
    console.log(`Próxima varredura em ${Math.round(INTERVAL_MS / 1000)}s. Pressione Ctrl+C para encerrar.`);
    await wait(INTERVAL_MS);
  }
} while (!stopping);

async function runCycle() {
  cycle += 1;
  cycleAlerts = [];
  cycleSites = new Map();
  const totals = { high: 0, critical: 0 };
  // Uma conexão por credencial SFTP, aberta na primeira vez que um site precisa dela e reaproveitada.
  // As conexões são abertas uma de cada vez: muitas simultâneas fazem algumas hospedagens bloquear a porta 22.
  const connections = new Map();
  const sftpFor = async (site) => {
    const id = sftpKey(site);
    if (!connections.has(id)) {
      assertSftp(site);
      const client = new SftpClient(`wp-monitor-${cycle}-${connections.size}`);
      await client.connect({ ...site.sftp, readyTimeout: 20000 });
      connections.set(id, client);
    }
    return connections.get(id);
  };

  console.log(`\n[${new Date().toLocaleString('pt-BR')}] Ciclo ${cycle}`);

  // Cada site é verificado de forma isolada (ver o laço abaixo).
  const scanSite = async (site) => {
    const previous = state.sites?.[site.key] || { files: {}, users: [] };
    const forceFullHash = FORCE_FULL_HASH || !state.sites?.[site.key] || cycle % FULL_HASH_EVERY === 0;
    console.log(`\n${site.name}: inventariando arquivos${forceFullHash ? ' (hash completo)' : ''}...`);
    const sftp = await sftpFor(site);
    const inventory = await listTree(sftp, site.remoteRoot);
    const remoteFiles = inventory.files;
    await addPinnedFiles(sftp, site.remoteRoot, remoteFiles);
    const oldUnreadable = new Set(previous.unreadable || []);
    for (const directory of inventory.unreadable) {
      if (!oldUnreadable.has(directory)) {
        await emitAlert('high', site.key, 'Diretório remoto não pôde ser lido', { path: directory });
        totals.high += 1;
      }
    }
    // Marcadores do malware (sc_XXXXXX, scgXXXXXX, z, .sc_*, .kk_*...) não têm extensão e não entram no
    // inventário por hash; são procurados pelo nome na raiz, em wp-content e em mu-plugins.
    const markersByDir = {};
    for (const file of remoteFiles) {
      const rel = file.path.slice(site.remoteRoot.length).replace(/^\//, '');
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      if (MARKER_DIRS.includes(dir) && isMalwareMarker(name, file.size)) (markersByDir[dir || '(raiz)'] ||= []).push(name);
    }
    for (const [dir, names] of Object.entries(markersByDir)) {
      await emitAlert('critical', site.key, 'Marcadores de malware encontrados', { pasta: dir, quantidade: names.length, exemplos: names.slice(0, 10) });
      totals.critical += 1;
    }

    // Drop-ins (db.php, advanced-cache.php, object-cache.php) e PHP solto em wp-content/cache: o WordPress
    // carrega os drop-ins em toda requisição. Malicioso → crítico em todo ciclo; origem desconhecida → alto
    // quando o arquivo aparece ou muda; origem reconhecida (plugin de cache) → nada.
    for (const file of remoteFiles) {
      const rel = file.path.slice(site.remoteRoot.length).replace(/^\//, '');
      const dropin = isDropin(rel);
      if (!dropin && !isCacheRootPhp(rel)) continue;
      const text = file.size <= MAX_DOWNLOAD_BYTES ? normalizeBuffer(await sftp.get(file.path)).toString('latin1') : '';
      const { verdict, reason } = file.size <= MAX_DOWNLOAD_BYTES
        ? classifyPhp(rel, text)
        : { verdict: 'unknown', reason: 'arquivo acima do limite de inspeção' };
      const old = previous.files?.[rel];
      const isNewOrChanged = !old || old.size !== file.size || old.mtime !== file.modifyTime;
      if (verdict === 'malicious') {
        await emitAlert('critical', site.key, dropin ? 'Drop-in malicioso' : 'PHP malicioso em wp-content/cache', { path: rel, motivo: reason, size: file.size });
        totals.critical += 1;
      } else if (verdict === 'unknown' && isNewOrChanged) {
        await emitAlert('high', site.key, dropin ? 'Drop-in sem origem reconhecida' : 'PHP em wp-content/cache sem origem reconhecida', { path: rel, size: file.size });
        totals.high += 1;
      }
    }

    const currentFiles = {};
    const candidates = remoteFiles.filter(shouldMonitor);

    await mapLimit(candidates, 4, async (file) => {
      const rel = file.path.slice(site.remoteRoot.length).replace(/^\//, '');
      const old = previous.files?.[rel];
      const changed = !old || old.size !== file.size || old.mtime !== file.modifyTime;
      let hash = old?.hash || null;

      if ((changed || forceFullHash) && file.size <= MAX_DOWNLOAD_BYTES) {
        const body = normalizeBuffer(await sftp.get(file.path));
        hash = crypto.createHash('sha256').update(body).digest('hex');
        if (!old || old.hash !== hash) {
          for (const finding of inspectFile(rel, body)) {
            await emitAlert(finding.severity, site.key, finding.message, { path: rel, size: file.size });
            totals[finding.severity] += 1;
          }
        }
      } else if (changed && old && file.size > MAX_DOWNLOAD_BYTES) {
        await emitAlert('high', site.key, 'Arquivo alterado excede o limite de inspeção', { path: rel, size: file.size });
        totals.high += 1;
      }

      currentFiles[rel] = { hash, size: file.size, mtime: file.modifyTime };
      if (old && hash && old.hash && hash !== old.hash) {
        await emitAlert('high', site.key, 'Arquivo monitorado foi alterado', { path: rel, oldHash: old.hash, newHash: hash });
        totals.high += 1;
      } else if (!old && state.sites?.[site.key]) {
        await emitAlert('high', site.key, 'Novo arquivo monitorado', { path: rel, hash });
        totals.high += 1;
      }
    });

    if (state.sites?.[site.key]) {
      for (const rel of Object.keys(previous.files || {})) {
        if (!currentFiles[rel] && !isKnownVolatileData(rel)) {
          await emitAlert('high', site.key, 'Arquivo monitorado foi removido', { path: rel });
          totals.high += 1;
        }
      }
    }

    const http = await inspectHttp(site);
    for (const finding of http.findings) {
      await emitAlert(finding.severity, site.key, finding.message, finding.details);
      totals[finding.severity] += 1;
    }

    const dbResult = await inspectDatabase(site, previous);
    for (const finding of dbResult.findings) {
      await emitAlert(finding.severity, site.key, finding.message, finding.details);
      totals[finding.severity] += 1;
    }

    state.sites[site.key] = {
      files: currentFiles,
      users: dbResult.users.length ? dbResult.users : previous.users || [],
      database: dbResult.snapshot || previous.database || null,
      unreadable: inventory.unreadable,
      lastHttp: http.summary,
      scannedAt: new Date().toISOString(),
    };

    cycleSites.set(site.key, {
      files: candidates.length, unreadable: inventory.unreadable.length, http: http.summary,
      dbChecked: Boolean(dbResult.snapshot), users: dbResult.users, db: dbResult.snapshot,
    });
    console.log(`${site.name}: ${candidates.length} arquivos monitorados; HTTP ${http.summary.homeStatus}.`);
  };

  try {
    for (const site of sites) {
      // Uma falha em um site (SFTP, listagem, hash) gera alerta para ele e o ciclo segue com os demais;
      // o estado anterior do site que falhou é mantido.
      try {
        await scanSite(site);
      } catch (error) {
        await emitAlert('critical', site.key, 'Falha ao verificar o site', { error: error.message });
        cycleSites.set(site.key, { error: error.message });
        totals.critical += 1;
        console.warn(`${site.name}: verificação interrompida (${error.message}); estado anterior mantido.`);
        // A conexão pode ter ficado inválida: descarta para o próximo site com a mesma credencial reconectar.
        const id = sftpKey(site);
        if (connections.has(id)) {
          await connections.get(id).end().catch(() => {});
          connections.delete(id);
        }
      }
    }
  } finally {
    for (const client of connections.values()) await client.end().catch(() => {});
  }

  state.version = 1;
  state.cycle = cycle;
  state.updatedAt = new Date().toISOString();
  state.createdAt ||= state.updatedAt;
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  if (RESET_BASELINE) {
    const trusted = { ...state, trustedAt: new Date().toISOString() };
    await fs.writeFile(BASELINE_FILE, `${JSON.stringify(trusted, null, 2)}\n`, 'utf8');
  }
  return totals;
}

async function listTree(sftp, root) {
  const files = [];
  const unreadable = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await sftp.list(directory);
    } catch {
      unreadable.push(directory.slice(root.length).replace(/^\//, '') || '.');
      continue;
    }
    for (const entry of entries) {
      const fullPath = `${directory}/${entry.name}`.replace(/\/+/g, '/');
      if (entry.type === 'd') pending.push(fullPath);
      else if (entry.type === '-') files.push({ ...entry, path: fullPath });
    }
  }
  return { files, unreadable };
}

async function addPinnedFiles(sftp, root, files) {
  const existing = new Set(files.map((file) => file.path));
  const pinned = [
    '.htaccess',
    'wp-config.php',
    'wp-content/uploads/.htaccess',
    'wp-content/mu-plugins/security-hardening.php',
  ];
  for (const relative of pinned) {
    const remotePath = `${root}/${relative}`;
    if (existing.has(remotePath)) continue;
    try {
      const stat = await sftp.stat(remotePath);
      files.push({ path: remotePath, size: stat.size, modifyTime: stat.modifyTime, type: '-' });
    } catch {
      // A ausência será percebida por comparação com a baseline quando aplicável.
    }
  }
}

function shouldMonitor(file) {
  const lower = file.path.toLowerCase();
  const base = path.posix.basename(lower);
  if (isKnownVolatileData(lower)) return false;
  // Em mu-plugins tudo é monitorado: o malware deixou ali marcadores sem extensão (.sd_*, .bt_*, .swm_*).
  if (/\/wp-content\/mu-plugins\//.test(lower)) return true;
  return monitoredExtensions.has(path.posix.extname(lower)) || base === '.htaccess' || base === '.user.ini';
}

function isKnownVolatileData(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)wp-content\/uploads\/sucuri\/sucuri-[a-z0-9_-]+\.php$/.test(normalized);
}

function inspectFile(relativePath, buffer) {
  const findings = [];
  const normalized = relativePath.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const base = path.posix.basename(lower);
  const phpLike = /\.(?:php\d*|phtml|phar|phps)$/i.test(base);
  const allowedSucuriData = /^wp-content\/uploads\/sucuri\/sucuri-[a-z0-9_-]+\.php$/i.test(lower);

  if (phpLike && /(^|\/)wp-content\/uploads\//i.test(lower) && !allowedSucuriData) {
    findings.push({ severity: 'critical', message: 'Arquivo PHP encontrado dentro de uploads' });
  }
  if (phpLike && base.startsWith('.')) {
    findings.push({ severity: 'critical', message: 'Arquivo PHP oculto encontrado' });
  }
  if (phpLike && /\.(?:jpg|jpeg|png|gif|webp|ico)\.php\d*$/i.test(base)) {
    findings.push({ severity: 'critical', message: 'Arquivo PHP com extensão dupla' });
  }
  if (/^(?:wp-content\/mu-plugins|wp-content\/plugins\/vapor-curator-tap)\/vapor-curator-tap\.php$/i.test(lower)) {
    findings.push({ severity: 'critical', message: 'Arquivo conhecido de persistência maliciosa' });
  }
  if (/^wp-content\/mu-plugins\/(?:.*\/)?\.(?:sd|bt|swm|rd)_[a-z0-9_-]+$/i.test(lower)) {
    findings.push({ severity: 'critical', message: 'Marcador oculto de malware em mu-plugins' });
  }

  const text = buffer.toString('utf8');
  for (const [severity, message, pattern] of contentRules) {
    if (!phpLike && message.startsWith('PHP ')) continue;
    if (pattern.test(text)) findings.push({ severity, message });
  }
  return findings;
}

function normalizeBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.concat(value.map((part) => normalizeBuffer(part)));
  if (typeof value === 'string') return Buffer.from(value);
  throw new TypeError(`Resposta SFTP inesperada: ${Object.prototype.toString.call(value)}`);
}

async function inspectHttp(site) {
  const findings = [];
  const home = await httpRequest(`${site.url}/`);
  const expectedHost = new URL(site.url).hostname;
  const finalHost = safeHostname(home.url);

  if (home.status < 200 || home.status >= 400) {
    findings.push({ severity: 'critical', message: 'Site indisponível ou com erro HTTP', details: { status: home.status, url: home.url } });
  }
  if (finalHost && finalHost !== expectedHost && !finalHost.endsWith(`.${expectedHost}`)) {
    findings.push({ severity: 'critical', message: 'Redirecionamento para domínio externo', details: { expectedHost, finalUrl: home.url } });
  }

  // SEO spam: links externos em blocos posicionados fora da tela. A home também é pedida como Googlebot,
  // porque esse tipo de injeção às vezes só aparece para o buscador.
  const homeHtml = typeof home.text === 'function' ? await home.text().catch(() => '') : '';
  const asGooglebot = await httpRequest(`${site.url}/`, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
  const googlebotHtml = typeof asGooglebot.text === 'function' ? await asGooglebot.text().catch(() => '') : '';
  for (const [agent, html] of [['navegador', homeHtml], ['Googlebot', googlebotHtml]]) {
    const blocks = findHiddenBlocks(html, expectedHost);
    if (blocks.length) {
      const hosts = blocks.flatMap((b) => b.hosts);
      findings.push({ severity: 'critical', message: 'Links externos ocultos na home', details: { visto_como: agent, blocos: blocks.length, links: hosts.length, dominios: [...new Set(hosts)] } });
    }
  }

  const expectedHeaders = ['strict-transport-security', 'x-content-type-options', 'x-frame-options'];
  for (const header of expectedHeaders) {
    if (!home.headers.get(header)) {
      findings.push({ severity: 'high', message: 'Cabeçalho de segurança ausente', details: { header } });
    }
  }

  const xmlrpc = await httpRequest(`${site.url}/xmlrpc.php`);
  if (xmlrpc.status !== 403) {
    findings.push({ severity: 'high', message: 'XML-RPC deixou de retornar 403', details: { status: xmlrpc.status } });
  }

  const uploadProbe = await httpRequest(`${site.url}/wp-content/uploads/wp-monitor-probe.php`);
  if (uploadProbe.status !== 403) {
    findings.push({ severity: 'critical', message: 'Bloqueio de PHP em uploads não está ativo', details: { status: uploadProbe.status } });
  }

  return {
    findings,
    summary: { homeStatus: home.status, finalUrl: home.url, xmlrpcStatus: xmlrpc.status, uploadProbeStatus: uploadProbe.status },
  };
}

async function httpRequest(url, userAgent = 'WordPress-External-Security-Monitor/1.0') {
  try {
    return await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': userAgent },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    return { status: 0, url, headers: new Headers(), error: error.message };
  }
}

async function inspectDatabase(site, previousSiteState) {
  const findings = [];
  if (!site.db.enabled) return { findings, users: [], snapshot: null };
  const prefix = site.db.prefix;
  if (!/^[A-Za-z0-9_]+$/.test(prefix)) throw new Error(`Prefixo de banco inválido para ${site.name}`);

  let connection;
  try {
    connection = await mysql.createConnection({
      host: site.db.host,
      port: site.db.port,
      database: site.db.database,
      user: site.db.user,
      password: site.db.password,
      connectTimeout: 10000,
      ssl: site.db.ssl ? {} : undefined,
    });

    const [users] = await connection.query(
      `SELECT u.ID, u.user_login, u.user_email, u.user_registered, COALESCE(m.meta_value, '') AS capabilities
       FROM \`${prefix}users\` u
       LEFT JOIN \`${prefix}usermeta\` m
         ON m.user_id = u.ID AND m.meta_key = ?
       ORDER BY u.ID`,
      [`${prefix}capabilities`],
    );
    const normalizedUsers = users.map((user) => ({
      id: String(user.ID),
      login: user.user_login,
      email: user.user_email,
      registered: user.user_registered,
      capabilities: user.capabilities,
    }));
    const previousUsers = previousSiteState.users || [];
    const oldIds = new Set(previousUsers.map((user) => String(user.id)));
    const currentIds = new Set(normalizedUsers.map((user) => String(user.id)));
    const oldById = new Map(previousUsers.map((user) => [String(user.id), user]));
    if (previousUsers.length) {
      for (const user of normalizedUsers) {
        if (!oldIds.has(user.id)) {
          findings.push({ severity: 'critical', message: 'Novo usuário WordPress detectado', details: user });
          continue;
        }
        const old = oldById.get(user.id);
        if (old.login !== user.login || old.email !== user.email || old.capabilities !== user.capabilities) {
          findings.push({
            severity: 'critical',
            message: 'Identidade ou permissões de usuário foram alteradas',
            details: { id: user.id, before: old, after: user },
          });
        }
      }
      for (const old of previousUsers) {
        if (!currentIds.has(String(old.id))) {
          findings.push({ severity: 'high', message: 'Usuário WordPress foi removido', details: old });
        }
      }
    }

    const [[applicationPasswords]] = await connection.query(
      `SELECT COUNT(*) AS total FROM \`${prefix}usermeta\` WHERE meta_key = '_application_passwords'`,
    );
    if (Number(applicationPasswords.total) > 0) {
      findings.push({ severity: 'critical', message: 'Application Passwords encontradas', details: { total: Number(applicationPasswords.total) } });
    }

    const [optionRows] = await connection.query(
      `SELECT option_name, option_value FROM \`${prefix}options\`
       WHERE option_name IN ('cron', 'active_plugins', 'users_can_register', 'siteurl', 'home', 'wpse_user_id')`,
    );
    const options = Object.fromEntries(optionRows.map((row) => [row.option_name, String(row.option_value || '')]));
    const cron = options.cron || '';
    if (/(?:ucow453w8ve76hghgr|tf5uwlmqvz1oes|sc_cron_fetch|eval\s*\(|base64_decode\s*\()/i.test(cron)) {
      findings.push({ severity: 'critical', message: 'Assinatura suspeita encontrada no WP-Cron', details: {} });
    }
    if (options.wpse_user_id) {
      findings.push({ severity: 'critical', message: 'Opção de persistência wpse_user_id reapareceu', details: {} });
    }
    if (options.users_can_register === '1') {
      findings.push({ severity: 'critical', message: 'Cadastro público foi ativado no banco', details: {} });
    }

    const cronHooks = extractCronHooks(cron);
    const previousSnapshot = previousSiteState.database;
    if (previousSnapshot?.cronHooks) {
      const previousHooks = new Set(previousSnapshot.cronHooks);
      for (const hook of cronHooks) {
        if (!previousHooks.has(hook)) {
          findings.push({ severity: 'high', message: 'Novo hook de WP-Cron detectado', details: { hook } });
        }
      }
    }

    const activePluginsHash = sha256(options.active_plugins || '');
    if (previousSnapshot?.activePluginsHash && previousSnapshot.activePluginsHash !== activePluginsHash) {
      findings.push({ severity: 'high', message: 'Lista de plugins ativos foi alterada', details: {} });
    }

    for (const optionName of ['siteurl', 'home']) {
      const configuredHost = safeHostname(options[optionName]);
      const expectedHost = new URL(site.url).hostname;
      if (configuredHost && configuredHost !== expectedHost) {
        findings.push({
          severity: 'critical',
          message: `Domínio inesperado na opção ${optionName}`,
          details: { value: options[optionName] },
        });
      }
    }

    const [posts] = await connection.query(
      `SELECT ID, post_author, post_date, post_status, post_type, post_title
       FROM \`${prefix}posts\`
       WHERE post_type IN ('post', 'page')
         AND post_status NOT IN ('auto-draft', 'inherit', 'trash')
       ORDER BY ID`,
    );
    const normalizedPosts = posts.map((post) => ({
      id: String(post.ID),
      author: String(post.post_author),
      date: post.post_date,
      status: post.post_status,
      type: post.post_type,
      title: post.post_title,
    }));
    if (previousSnapshot?.postIds) {
      const previousPostIds = new Set(previousSnapshot.postIds.map(String));
      for (const post of normalizedPosts) {
        if (!previousPostIds.has(post.id)) {
          findings.push({ severity: 'high', message: 'Novo post ou página detectado', details: post });
        }
      }
    }

    // SEO spam salvo no conteúdo: Elementor (_elementor_data) e post_content de páginas, posts e modelos.
    const siteHost = new URL(site.url).hostname;
    const [contentRows] = await connection.query(
      `SELECT p.ID, p.post_title, p.post_type, p.post_status, p.post_content, m.meta_value AS elementor
       FROM \`${prefix}posts\` p
       LEFT JOIN \`${prefix}postmeta\` m ON m.post_id = p.ID AND m.meta_key = '_elementor_data'
       WHERE p.post_type NOT IN ('revision', 'attachment', 'nav_menu_item')
         AND p.post_status IN ('publish', 'private', 'draft', 'future', 'pending')
         AND (p.post_content LIKE '%position%' OR m.meta_value LIKE '%position%')`,
    );
    for (const row of contentRows) {
      const fromElementor = row.elementor ? scanElementorData(String(row.elementor), siteHost) : [];
      const fromContent = findHiddenBlocks(String(row.post_content || ''), siteHost);
      if (!fromElementor.length && !fromContent.length) continue;
      const hosts = [...fromElementor.flatMap((f) => f.hosts), ...fromContent.flatMap((b) => b.hosts)];
      findings.push({
        severity: 'critical',
        message: 'Links externos ocultos no conteúdo',
        details: {
          postId: String(row.ID), titulo: row.post_title, tipo: row.post_type, status: row.post_status,
          widgets: [...new Set(fromElementor.map((f) => f.elementId).filter(Boolean))],
          em_post_content: fromContent.length > 0, links: hosts.length, dominios: [...new Set(hosts)],
        },
      });
    }

    const [sessionRows] = await connection.query(
      `SELECT user_id, meta_value FROM \`${prefix}usermeta\` WHERE meta_key = 'session_tokens'`,
    );
    const loginById = new Map(normalizedUsers.map((user) => [user.id, user.login]));
    const sessions = parseSessions(sessionRows, loginById);
    const serverIps = await resolveServerIps(site);
    const previousSessionIds = previousSnapshot?.sessionIds ? new Set(previousSnapshot.sessionIds) : null;
    for (const session of sessions) {
      const reasons = suspiciousReasons(session, serverIps);
      if (reasons.length) {
        if (!previousSessionIds?.has(session.id)) {
          findings.push({ severity: 'critical', message: 'Sessão de login suspeita', details: { ...session, reasons } });
        }
      } else if (previousSessionIds && !previousSessionIds.has(session.id)) {
        findings.push({ severity: 'high', message: 'Nova sessão de login', details: session });
      }
    }

    const snapshot = {
      checkedAt: new Date().toISOString(),
      cronHooks,
      activePluginsHash,
      postIds: normalizedPosts.map((post) => post.id),
      applicationPasswordRows: Number(applicationPasswords.total),
      sessionRows: sessionRows.length,
      sessionIds: sessions.map((session) => session.id),
      usersCanRegister: options.users_can_register || '0',
      siteurl: options.siteurl || '',
      home: options.home || '',
    };

    console.log(`${site.name}: banco verificado; ${normalizedUsers.length} usuário(s), ${normalizedPosts.length} post(s)/página(s), ${cronHooks.length} hook(s) cron.`);
    return { findings, users: normalizedUsers, snapshot };
  } catch (error) {
    console.warn(`${site.name}: banco não verificado (${error.code || error.message}).`);
    return { findings, users: [], snapshot: null };
  } finally {
    await connection?.end().catch(() => {});
  }
}

async function resolveServerIps(site) {
  if (!serverIpCache.has(site.key)) serverIpCache.set(site.key, await lookupServerIps(site, process.env.SERVER_IPS));
  return serverIpCache.get(site.key);
}

function extractCronHooks(serializedCron) {
  const hooks = new Set();
  const pattern = /s:\d+:"([^"]+)";a:\d+:\{s:32:"[a-f0-9]{32}"/gi;
  for (const match of serializedCron.matchAll(pattern)) hooks.add(match[1]);
  return [...hooks].sort();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function alertContext(details = {}) {
  return details.path || [
    details.titulo && `"${details.titulo}"`, details.visto_como && `visto como ${details.visto_como}`,
    details.dominios && details.dominios.join(', '), details.pasta && `${details.pasta}: ${details.quantidade} arquivo(s)`,
    details.login && `${details.login} (${details.ip || 'IP desconhecido'})`, details.hook, details.error,
  ].filter(Boolean).join(' — ');
}

// Seção do relatório diário para a varredura/ciclo, no formato do relatório manual.
async function writeScanReport(startedAt, seconds, result) {
  const severityLabel = { critical: 'CRÍTICO', high: 'ALTO', info: 'INFO' };
  const blocked = (status) => (status === 403 ? `HTTP ${status} (bloqueado — correto)` : `HTTP ${status} (ATENÇÃO: deveria ser 403)`);
  const summary = [
    `Duração: ${seconds} segundos (ciclo nº ${cycle} do monitor)`,
    `Sites verificados: ${sites.map((s) => `${s.name} (${new URL(s.url).hostname})`).join(', ')}`,
    `Modo: ${ONCE ? 'varredura única (run-scan)' : 'monitor contínuo (ciclo com alertas)'}; nenhuma alteração é feita nos sites.`,
    '',
    result.critical || result.high
      ? `RESULTADO: ${result.critical} ALERTA(S) CRÍTICO(S) E ${result.high} ALTO(S)`
      : 'RESULTADO: NENHUMA ANOMALIA ENCONTRADA',
  ];
  const generalAlerts = cycleAlerts.filter((a) => !sites.some((s) => s.key === a.site));
  for (const a of generalAlerts) summary.push(...bullet(`[${severityLabel[a.severity] || a.severity}] ${a.message}${alertContext(a.details) ? ` — ${alertContext(a.details)}` : ''}`));
  const lines = [];
  for (const site of sites) {
    const info = cycleSites.get(site.key);
    const alerts = cycleAlerts.filter((a) => a.site === site.key);
    lines.push(`${site.name.toUpperCase()} — ${site.url}`, '');
    if (!info) {
      lines.push(...bullet('Não verificado neste ciclo.'), '');
      continue;
    }
    if (info.error) {
      lines.push(...bullet(`FALHA AO VERIFICAR O SITE: ${info.error}. O estado anterior foi mantido.`), '');
    } else {
      lines.push('Arquivos');
      lines.push(...bullet(`${number(info.files)} arquivos monitorados${info.unreadable ? `; ${info.unreadable} pasta(s) não puderam ser lidas` : ', todos lidos com sucesso'}.`));
      lines.push('', 'Site no ar (HTTP)');
      lines.push(...bullet(`Página inicial: HTTP ${info.http.homeStatus}${info.http.finalUrl ? ` (${info.http.finalUrl})` : ''}.`));
      lines.push(...bullet(`xmlrpc.php: ${blocked(info.http.xmlrpcStatus)}.`));
      lines.push(...bullet(`Execução de PHP em uploads: ${blocked(info.http.uploadProbeStatus)}.`));
      lines.push('', 'Banco de dados');
      if (!info.dbChecked) {
        lines.push(...bullet(site.db.enabled ? 'Não verificado (sem conexão com o banco).' : 'Não configurado.'));
      } else {
        const admins = info.users.filter((u) => /administrator/.test(u.capabilities || '')).length;
        lines.push(...bullet(`${info.users.length} usuário(s) (${admins} administrador(es)): ${info.users.map((u) => u.login).join(', ')}.`));
        lines.push(...bullet(`Posts/páginas publicados: ${info.db.postIds.length}. Tarefas no WP-Cron: ${info.db.cronHooks.length}.`));
        lines.push(...bullet(`Sessões de login: ${info.db.sessionRows}. Application Passwords: ${info.db.applicationPasswordRows}. Cadastro público: ${info.db.usersCanRegister === '1' ? 'ATIVADO' : 'desativado'}.`));
        lines.push(...bullet(`Endereço do site (siteurl): ${info.db.siteurl || '-'}.`));
      }
    }
    lines.push('', 'Alertas');
    if (!alerts.length) lines.push(...bullet('Nenhum.'));
    for (const a of alerts) lines.push(...bullet(`[${severityLabel[a.severity] || a.severity}] ${a.message}${alertContext(a.details) ? ` — ${alertContext(a.details)}` : ''}`));
    lines.push('');
  }
  const title = `${ONCE ? 'VARREDURA' : 'MONITOR — CICLO COM ALERTAS'} — ${dateBR(startedAt)}, ${timeBR(startedAt)} (horário de Brasília)`;
  return appendSection(REPORTS_DIR, { title, summary, lines }, startedAt);
}

async function emitAlert(severity, site, message, details = {}) {
  const event = { timestamp: new Date().toISOString(), severity, site, message, details };
  const color = severity === 'critical' ? '\x1b[31m' : '\x1b[33m';
  const context = alertContext(details);
  console.error(`${color}[${severity.toUpperCase()}]\x1b[0m ${site}: ${message}${context ? ` — ${context}` : ''}`);
  await fs.appendFile(ALERT_FILE, `${JSON.stringify(event)}\n`, 'utf8');
  cycleAlerts.push(event);
}

async function loadState() {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    parsed.sites ||= {};
    return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Estado anterior inválido: ${error.message}`);
    return { version: 1, createdAt: new Date().toISOString(), cycle: 0, sites: {} };
  }
}

// Em caso de erro, para de pegar novos itens e espera os trabalhos em andamento terminarem antes de repassar
// o erro: assim nenhuma tarefa continua rodando sozinha depois que a conexão do site é descartada.
async function mapLimit(items, limit, worker) {
  let index = 0;
  let failed = false;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && index < items.length) {
      const current = index++;
      try {
        await worker(items[current]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  const results = await Promise.allSettled(runners);
  const rejected = results.find((r) => r.status === 'rejected');
  if (rejected) throw rejected.reason;
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
