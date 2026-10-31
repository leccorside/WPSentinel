// Novas funcionalidades do painel (Passo 5):
// - Sessões de login ao vivo por site (consulta somente-leitura ao banco)
// - Teste de conectividade por site: SFTP, MySQL e HTTP/SSL com latência
// - Configurações: ler e gravar no .env apenas chaves permitidas
// - Resumo executivo em Markdown ("Gerar Relatório para Cliente")
// - Marcar itens de revisão manual como revisados (persistido em .monitor-data/reviewed-items.json)

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import express from 'express';
import mysql from 'mysql2/promise';
import SftpClient from 'ssh2-sftp-client';
import { loadSites, saveSites, sanitizeSite } from '../src/config.mjs';
import { lookupServerIps, parseSessions, suspiciousReasons } from '../src/sessions.mjs';
import { ENV_FILE, readEnvFile } from './config.mjs';
import { readAlerts, readBaseline, readPlan, readState, summarizeSite } from './data.mjs';

const ALLOWED_CONFIG_KEYS = new Set([
  'INTERVAL_SECONDS',
  'FULL_HASH_EVERY',
  'MAX_DOWNLOAD_BYTES',
  'SERVER_IPS',
  'MONITOR_AUTOSTART',
]);

export function createFeaturesRouter({ paths }) {
  const router = express.Router();
  const { dataDir } = paths;
  const reviewedFile = path.join(dataDir, 'reviewed-items.json');

  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

  // 1. Sessões de login ao vivo por site (ou todos os sites)
  router.get('/sites/:key/sessions', route(async (req, res) => {
    const isAll = req.params.key === 'all';
    const allSites = loadSites(readEnvFile() || {}, dataDir);
    const targetSites = isAll ? allSites : [findSite(req.params.key)];

    let allSessions = [];
    let allServerIps = new Set();
    const env = readEnvFile() || {};

    for (const site of targetSites) {
      if (!site.db?.enabled || !site.db?.host) continue;

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

        const prefix = site.db.prefix || 'wp_';
        const [users] = await connection.query(`SELECT ID, user_login FROM \`${prefix}users\``);
        const loginById = new Map(users.map((u) => [String(u.ID), u.user_login]));

        const [sessionRows] = await connection.query(
          `SELECT user_id, meta_value FROM \`${prefix}usermeta\` WHERE meta_key = 'session_tokens'`,
        );

        const serverIps = await lookupServerIps(site, env.SERVER_IPS);
        for (const ip of serverIps) allServerIps.add(ip);

        const parsed = parseSessions(sessionRows, loginById);
        const mapped = parsed.map((session) => {
          const reasons = suspiciousReasons(session, serverIps);
          return {
            ...session,
            siteKey: site.key,
            siteName: site.name,
            suspicious: reasons.length > 0,
            reasons,
          };
        });

        allSessions = allSessions.concat(mapped);
      } catch (error) {
        if (!isAll) {
          throw httpError(500, `Falha ao consultar banco do site ${site.name}: ${error.code || error.message}`);
        }
      } finally {
        await connection?.end().catch(() => {});
      }
    }

    res.json({
      site: isAll ? 'all' : targetSites[0].key,
      siteName: isAll ? `Todos os Sites (${targetSites.length})` : targetSites[0].name,
      checkedAt: new Date().toISOString(),
      total: allSessions.length,
      suspiciousCount: allSessions.filter((s) => s.suspicious).length,
      serverIps: Array.from(allServerIps),
      sessions: allSessions,
    });
  }));

  // 2. Teste de conectividade por site (SFTP, MySQL, HTTP/SSL)
  const testHandler = route(async (req, res) => {
    const site = findSite(req.params.key);
    const [sftp, db, web] = await Promise.all([
      testSftp(site),
      testMysql(site),
      testHttp(site),
    ]);

    res.json({
      site: site.key,
      siteName: site.name,
      testedAt: new Date().toISOString(),
      sftp,
      mysql: db,
      http: web,
      healthy: sftp.ok && (!db.enabled || db.ok) && web.ok,
    });
  });

  router.post('/sites/:key/test', testHandler);
  router.get('/sites/:key/test', testHandler);

  // 3. Configurações: ler e gravar no .env
  router.get('/settings', route(async (req, res) => {
    const env = readEnvFile() || {};
    res.json({
      INTERVAL_SECONDS: Number(env.INTERVAL_SECONDS || 300),
      FULL_HASH_EVERY: Number(env.FULL_HASH_EVERY || 24),
      MAX_DOWNLOAD_BYTES: Number(env.MAX_DOWNLOAD_BYTES || 8388608),
      SERVER_IPS: env.SERVER_IPS || '',
      MONITOR_AUTOSTART: String(env.MONITOR_AUTOSTART).toLowerCase() === 'true' || env.MONITOR_AUTOSTART === '1',
    });
  }));

  router.post('/settings', route(async (req, res) => {
    const updates = req.body || {};
    let envRaw = '';
    try {
      envRaw = await fs.readFile(ENV_FILE, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const applied = {};
    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_CONFIG_KEYS.has(key)) continue;

      let formattedValue = '';
      if (key === 'INTERVAL_SECONDS') {
        formattedValue = String(Math.max(30, Number(value) || 300));
      } else if (key === 'FULL_HASH_EVERY') {
        formattedValue = String(Math.max(1, Number(value) || 24));
      } else if (key === 'MAX_DOWNLOAD_BYTES') {
        formattedValue = String(Math.max(1024, Number(value) || 8388608));
      } else if (key === 'SERVER_IPS') {
        formattedValue = String(value || '')
          .split(',')
          .map((ip) => ip.trim())
          .filter(Boolean)
          .join(',');
      } else if (key === 'MONITOR_AUTOSTART') {
        formattedValue = Boolean(value) && String(value) !== 'false' ? 'true' : 'false';
      }

      applied[key] = formattedValue;

      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envRaw)) {
        envRaw = envRaw.replace(regex, `${key}=${formattedValue}`);
      } else {
        envRaw = envRaw.trimEnd() + `\n${key}=${formattedValue}\n`;
      }
    }

    await fs.writeFile(ENV_FILE, envRaw, 'utf8');

    const env = readEnvFile() || {};
    res.json({
      ok: true,
      message: 'Configurações atualizadas no .env com sucesso',
      settings: {
        INTERVAL_SECONDS: Number(env.INTERVAL_SECONDS || 300),
        FULL_HASH_EVERY: Number(env.FULL_HASH_EVERY || 24),
        MAX_DOWNLOAD_BYTES: Number(env.MAX_DOWNLOAD_BYTES || 8388608),
        SERVER_IPS: env.SERVER_IPS || '',
        MONITOR_AUTOSTART: String(env.MONITOR_AUTOSTART).toLowerCase() === 'true' || env.MONITOR_AUTOSTART === '1',
      },
    });
  }));

  // 4. Resumo executivo em Markdown
  const executiveReportHandler = route(async (req, res) => {
    const env = readEnvFile() || {};
    const sites = loadSites(env);
    const [{ value: state }, { value: baseline }, { alerts, lastCleanup }] = await Promise.all([
      readState(dataDir),
      readBaseline(dataDir),
      readAlerts(dataDir),
    ]);

    const summaries = sites.map((site) =>
      summarizeSite(site, state?.sites?.[site.key], baseline?.sites?.[site.key]),
    );

    const markdown = generateExecutiveMarkdown({
      sites,
      summaries,
      state,
      baseline,
      alerts,
      lastCleanup,
      env,
    });

    if (req.path.endsWith('/download')) {
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="relatorio-executivo-sentinel-${stamp}.md"`);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.send(markdown);
    }

    res.json({
      generatedAt: new Date().toISOString(),
      markdown,
    });
  });

  router.get('/reports/executive', executiveReportHandler);
  router.get('/reports/executive/download', executiveReportHandler);

  // 5. Itens de revisão manual
  router.get('/manual-review', route(async (req, res) => {
    const { value: plan } = await readPlan(dataDir);
    const reviewedMap = await readReviewedMap();

    const items = (plan?.manualReview || []).map((item) => {
      const key = makeItemKey(item);
      const record = reviewedMap[key];
      return {
        ...item,
        key,
        reviewed: Boolean(record),
        reviewedAt: record?.reviewedAt || null,
        reviewedNotes: record?.notes || null,
      };
    });

    res.json({
      total: items.length,
      reviewedCount: items.filter((i) => i.reviewed).length,
      pendingCount: items.filter((i) => !i.reviewed).length,
      items,
    });
  }));

  router.post('/manual-review/mark', route(async (req, res) => {
    const { key, reviewed, notes = '' } = req.body || {};
    if (!key) throw httpError(400, 'Chave do item (key) é obrigatória.');

    const reviewedMap = await readReviewedMap();
    if (reviewed) {
      reviewedMap[key] = {
        reviewedAt: new Date().toISOString(),
        notes: String(notes || ''),
      };
    } else {
      delete reviewedMap[key];
    }

    await fs.writeFile(reviewedFile, `${JSON.stringify(reviewedMap, null, 2)}\n`, 'utf8');
    res.json({ ok: true, key, reviewed: Boolean(reviewed) });
  }));

  // 6. Gestão Dinâmica de Sites (Configuração 100% via Tela)
  router.get('/sites-manage', route(async (req, res) => {
    const list = loadSites(readEnvFile() || {}, dataDir);
    res.json({
      sites: list.map((s) => ({
        key: s.key,
        name: s.name,
        url: s.url,
        remoteRoot: s.remoteRoot,
        hasPassword: Boolean(s.sftp.password),
        sftp: {
          host: s.sftp.host,
          port: s.sftp.port,
          username: s.sftp.username,
          hasPassword: Boolean(s.sftp.password),
        },
        db: {
          enabled: Boolean(s.db?.enabled),
          host: s.db?.host || '',
          port: s.db?.port || 3306,
          database: s.db?.database || '',
          user: s.db?.user || '',
          prefix: s.db?.prefix || 'wp_',
          ssl: Boolean(s.db?.ssl),
          hasPassword: Boolean(s.db?.password),
        },
        spamContentSince: s.spamContentSince,
      })),
    });
  }));

  router.post('/sites-manage', route(async (req, res) => {
    const data = req.body || {};
    const key = String(data.key || '').trim().toLowerCase();
    if (!key || !/^[a-z0-9_-]+$/.test(key)) {
      throw httpError(400, 'Identificador (key) inválido. Use apenas letras minúsculas, números e hífens.');
    }

    const currentSites = loadSites(readEnvFile() || {}, dataDir);
    const existingIndex = currentSites.findIndex((s) => s.key === key);
    const existing = existingIndex >= 0 ? currentSites[existingIndex] : null;

    // Preserva senhas anteriores se não foram preenchidas na edição
    const sftpPassword = data.sftp?.password && data.sftp.password !== '••••••••'
      ? data.sftp.password
      : existing?.sftp?.password || '';

    const dbPassword = data.db?.password && data.db.password !== '••••••••'
      ? data.db.password
      : existing?.db?.password || '';

    const newSite = sanitizeSite({
      key,
      name: data.name || key,
      url: data.url,
      remoteRoot: data.remoteRoot,
      sftp: {
        host: data.sftp?.host || '',
        port: Number(data.sftp?.port || 22),
        username: data.sftp?.username || '',
        password: sftpPassword,
      },
      db: {
        enabled: Boolean(data.db?.enabled),
        host: data.db?.host || '',
        port: Number(data.db?.port || 3306),
        database: data.db?.database || '',
        user: data.db?.user || '',
        password: dbPassword,
        prefix: data.db?.prefix || 'wp_',
        ssl: Boolean(data.db?.ssl),
      },
      spamContentSince: data.spamContentSince || null,
    });

    let updatedList;
    if (existingIndex >= 0) {
      updatedList = [...currentSites];
      updatedList[existingIndex] = newSite;
    } else {
      updatedList = [...currentSites, newSite];
    }

    saveSites(updatedList, dataDir);
    res.json({ ok: true, site: newSite, totalSites: updatedList.length });
  }));

  router.delete('/sites-manage/:key', route(async (req, res) => {
    const key = req.params.key;
    const currentSites = loadSites(readEnvFile() || {}, dataDir);
    const updatedList = currentSites.filter((s) => s.key !== key);

    if (updatedList.length === currentSites.length) {
      throw httpError(404, `Site ${key} não encontrado para exclusão.`);
    }

    saveSites(updatedList, dataDir);
    res.json({ ok: true, removedKey: key, totalSites: updatedList.length });
  }));

  router.post('/sites-manage/test', route(async (req, res) => {
    const data = req.body || {};
    const key = String(data.key || '').trim().toLowerCase();
    const currentSites = loadSites(readEnvFile() || {}, dataDir);
    const existing = currentSites.find((s) => s.key === key);

    const sftpPassword = data.sftp?.password && data.sftp.password !== '••••••••'
      ? data.sftp.password
      : existing?.sftp?.password || '';

    const dbPassword = data.db?.password && data.db.password !== '••••••••'
      ? data.db.password
      : existing?.db?.password || '';

    const testTarget = {
      key: key || 'test',
      name: data.name || 'Teste',
      url: data.url || 'https://exemplo.com',
      remoteRoot: data.remoteRoot || '/public_html',
      sftp: {
        host: data.sftp?.host || '',
        port: Number(data.sftp?.port || 22),
        username: data.sftp?.username || '',
        password: sftpPassword,
      },
      db: {
        enabled: Boolean(data.db?.enabled && data.db?.host),
        host: data.db?.host || '',
        port: Number(data.db?.port || 3306),
        database: data.db?.database || '',
        user: data.db?.user || '',
        password: dbPassword,
        prefix: data.db?.prefix || 'wp_',
        ssl: Boolean(data.db?.ssl),
      },
    };

    const [sftp, db, web] = await Promise.all([
      testSftp(testTarget),
      testMysql(testTarget),
      testHttp(testTarget),
    ]);

    res.json({
      testedAt: new Date().toISOString(),
      sftp,
      mysql: db,
      http: web,
      healthy: sftp.ok && (!testTarget.db.enabled || db.ok) && web.ok,
    });
  }));

  return router;

  function findSite(key) {
    const site = loadSites(readEnvFile() || {}, dataDir).find((s) => s.key === key);
    if (!site) throw httpError(404, `Site não encontrado: ${key}`);
    return site;
  }

  async function readReviewedMap() {
    try {
      const raw = await fs.readFile(reviewedFile, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}

// Chave única determinística para cada item de revisão manual
export function makeItemKey(item) {
  const seed = `${item.site || ''}:${item.message || ''}:${item.details?.path || item.details?.hook || item.details?.postId || item.details?.titulo || item.reason || ''}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

// Os erros do ssh2 são genéricos; os casos comuns em hospedagem cPanel ganham uma explicação.
function explainSftpError(message, sftp) {
  if (Number(sftp.port) === 21) {
    return `${message} — a porta 21 é FTP; o WP Sentinel usa SFTP (SSH), normalmente na porta 22.`;
  }
  if (/All configured authentication methods failed/i.test(message)) {
    const subAccount = String(sftp.username || '').includes('@');
    return `${message} — ${subAccount
      ? 'contas FTP adicionais do cPanel (usuario@dominio) não têm acesso SFTP; use o usuário principal da hospedagem.'
      : 'usuário ou senha recusados pelo SSH (senha trocada, acesso SSH desativado ou IP bloqueado pela hospedagem).'}`;
  }
  return message;
}

// Teste SFTP
async function testSftp(site) {
  const start = Date.now();
  let client;
  try {
    client = new SftpClient(`test-sftp-${Date.now()}`);
    await client.connect({ ...site.sftp, readyTimeout: 10000 });
    await client.stat(site.remoteRoot);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      host: site.sftp.host,
      port: site.sftp.port,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      host: site.sftp.host,
      port: site.sftp.port,
      error: explainSftpError(err.message, site.sftp),
    };
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

// Teste MySQL
async function testMysql(site) {
  if (!site.db.enabled) {
    return { enabled: false, ok: null, message: 'Banco desativado' };
  }
  const start = Date.now();
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
    await connection.query('SELECT 1');
    return {
      enabled: true,
      ok: true,
      latencyMs: Date.now() - start,
      host: site.db.host,
      port: site.db.port,
      database: site.db.database,
    };
  } catch (err) {
    return {
      enabled: true,
      ok: false,
      latencyMs: Date.now() - start,
      host: site.db.host,
      port: site.db.port,
      error: err.code || err.message,
    };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

// Teste HTTP & Validação de Certificado SSL
async function testHttp(site) {
  const start = Date.now();
  return new Promise((resolve) => {
    let urlObj;
    try {
      urlObj = new URL(site.url);
    } catch (err) {
      return resolve({ ok: false, error: `URL inválida: ${err.message}`, latencyMs: 0 });
    }

    const isHttps = urlObj.protocol === 'https:';
    const clientModule = isHttps ? https : http;
    const options = {
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WPSentinel/1.0; +https://sentinel.local)',
      },
    };

    const req = clientModule.request(urlObj, options, (res) => {
      const latencyMs = Date.now() - start;
      let ssl = null;

      if (isHttps && res.socket?.getPeerCertificate) {
        try {
          const cert = res.socket.getPeerCertificate();
          if (cert && cert.valid_to) {
            const validTo = new Date(cert.valid_to);
            const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            ssl = {
              valid: daysRemaining > 0,
              validFrom: cert.valid_from,
              validTo: cert.valid_to,
              daysRemaining,
              issuer: cert.issuer?.O || cert.issuer?.CN || 'Desconhecido',
              subject: cert.subject?.CN || urlObj.hostname,
            };
          }
        } catch {}
      }

      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 400,
        statusCode: res.statusCode,
        latencyMs,
        url: site.url,
        ssl,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout de conexão após 10s', latencyMs: Date.now() - start });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message, latencyMs: Date.now() - start });
    });

    req.end();
  });
}

// Gerador do Relatório Executivo em Markdown
function generateExecutiveMarkdown({ sites, summaries, state, baseline, alerts, lastCleanup }) {
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('pt-BR', { dateStyle: 'long' });
  const timeFormatted = now.toLocaleTimeString('pt-BR');

  const totalFiles = summaries.reduce((acc, s) => acc + (s.files?.monitored || 0), 0);
  const totalSessions = summaries.reduce((acc, s) => acc + (s.database?.sessions || 0), 0);
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical').length;
  const highAlerts = alerts.filter((a) => a.severity === 'high').length;

  let md = `# Relatório Executivo de Segurança — WP Sentinel\n\n`;
  md += `**Data de Emissão:** ${dateFormatted} às ${timeFormatted}  \n`;
  md += `**Ciclo Analisado:** ${state?.cycle ? `Ciclo ${state.cycle}` : 'N/A'}  \n`;
  md += `**Baseline de Integridade:** ${baseline?.trustedAt ? new Date(baseline.trustedAt).toLocaleString('pt-BR') : 'Não definida'}  \n\n`;

  md += `## 1. Sumário Executivo\n\n`;
  md += `O **WP Sentinel** realizou a auditoria contínua de integridade nos sites monitorados, verificando arquivos via SFTP, estrutura e usuários no MySQL, além de monitorar drop-ins, tarefas cron e redirecionamentos maliciosos.\n\n`;
  md += `- **Sites sob Custódia:** ${sites.length} site(s)\n`;
  md += `- **Arquivos Monitorados:** ${totalFiles.toLocaleString('pt-BR')}\n`;
  md += `- **Sessões Ativas Analisadas:** ${totalSessions}\n`;
  md += `- **Alertas Críticos:** ${criticalAlerts}\n`;
  md += `- **Alertas Altos:** ${highAlerts}\n\n`;

  md += `## 2. Perímetro Monitorado\n\n`;
  md += `| Site | URL | Arquivos | Integridade Baseline | Banco MySQL | Sessões |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: |\n`;
  for (const s of summaries) {
    const diff = (s.files?.modified || 0) + (s.files?.added || 0) + (s.files?.removed || 0);
    const integrityStatus = diff === 0 ? '✅ 100% Íntegro' : `⚠️ ${diff} divergência(s)`;
    const dbStatus = s.database ? '✅ Ativo' : '➖ Desativado';
    md += `| **${s.name}** | [${s.url}](${s.url}) | ${s.files?.monitored || 0} | ${integrityStatus} | ${dbStatus} | ${s.database?.sessions || 0} |\n`;
  }
  md += `\n`;

  md += `## 3. Detalhamento de Segurança por Site\n\n`;
  for (const s of summaries) {
    md += `### ${s.name} (${s.url})\n\n`;
    md += `- **Arquivos Confiáveis:** ${s.files?.trusted || 0}\n`;
    md += `- **Arquivos Alterados/Novos:** Alterados: ${s.files?.modified || 0}, Novos: ${s.files?.added || 0}, Removidos: ${s.files?.removed || 0}\n`;
    md += `- **Arquivos PHP em Uploads:** ${s.files?.phpInUploads || 0} (esperado: 0)\n`;
    md += `- **Marcadores de Malware Conhecidos:** ${s.files?.malwareMarkers || 0}\n`;
    if (s.database) {
      md += `- **Usuários Registrados:** ${s.database.users || 0} (Administradores: ${s.database.adminUsers || 0})\n`;
      md += `- **Cadastro Público:** ${s.database.usersCanRegister === '1' ? '⚠️ Ativado' : '✅ Desativado'}\n`;
      md += `- **Application Passwords:** ${s.database.applicationPasswords || 0}\n`;
      md += `- **Hooks no WP-Cron:** ${s.database.cronHooks || 0}\n`;
    }
    md += `\n`;
  }

  md += `## 4. Histórico de Limpeza e Mitigações\n\n`;
  if (lastCleanup) {
    md += `- **Última Limpeza:** ${new Date(lastCleanup.timestamp).toLocaleString('pt-BR')}\n`;
    md += `- **Plano Executado:** \`${lastCleanup.details?.planId || 'N/A'}\`\n`;
    md += `- **Ações Executadas:** ${lastCleanup.details?.completed?.length || 0} ação(ões)\n`;
  } else {
    md += `Nenhuma limpeza automática registrada recentemente no histórico.\n`;
  }
  md += `\n`;

  md += `## 5. Recomendações Técnicas de Hardening\n\n`;
  md += `1. **Permissões de Execução:** Certifique-se de que a execução de scripts PHP na pasta \`wp-content/uploads\` permaneça desativada via servidor web ou regras \`.htaccess\`.\n`;
  md += `2. **Usuários e Credenciais:** Mantenha o cadastro público de usuários desativado caso o site não seja uma comunidade aberta.\n`;
  md += `3. **Revisão de Hashes:** Realize revalidações periódicas completas de hash após atualizações de plugins ou temas legítimos para atualizar a baseline confiável.\n`;
  md += `4. **Rotatividade de Sessões:** Encerre sessões de administradores antigas ou com User-Agents genéricos para evitar sequestro de sessão.\n\n`;

  md += `---\n*Documento gerado automaticamente pelo motor do WP Sentinel.*  \n`;
  return md;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
