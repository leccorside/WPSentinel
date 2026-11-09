#!/usr/bin/env node

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import SftpClient from 'ssh2-sftp-client';
import mysql from 'mysql2/promise';
import { serialize, unserialize } from 'php-serialize';
import { cleanElementorRaw, findHiddenBlocks, scanElementorData, stripHiddenBlocks } from './hidden-links.mjs';
import { MARKER_DIRS, isMalwareMarker } from './malware-markers.mjs';
import { assertSftp, connectSftpWithRetry, dataPaths, loadSites, sftpKey, writeFileAtomic } from './config.mjs';
import { DROPIN_FILES, classifyPhp, isCacheRootPhp, isDropin } from './dropins.mjs';
import { appendSection, bullet, dateBR, timeBR } from './report.mjs';
import { lastCleanupFinder, selectSites, siteArg } from './scope.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { dataDir: DATA_DIR, reportsDir: REPORTS_DIR } = dataPaths(ROOT_DIR);
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const BASELINE_FILE = path.join(DATA_DIR, 'trusted-baseline.json');
const ALERT_FILE = path.join(DATA_DIR, 'alerts.jsonl');
const PLAN_FILE = path.join(DATA_DIR, 'last-cleanup-plan.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MALICIOUS_PLUGIN = /^(vapor-curator-tap|pulse-beacon-ops|cloudflare-v2-23|script-4aec0f13-4aec0f13|wordpress-site-editor-e64d0d1c|wp-security-helper|smart-toolkit-plus|database-framework-edition|performance-fix-pro|smart-fix-edition|system-fix-plus|smart-cleaner-plus|smart-fix-pro|core-manager-plus|seo-patch-max|classic-cleaner-bundle|core-scanner-standard|wpueditors|fileorganizer|code-snippets|seo-framework-x|visual-scanner-edition)$|^(gallery|security|custom|widget)[_-]17781\d{5}$/;
// Todos os da lista acima são apagados na limpeza, inclusive code-snippets e fileorganizer (legítimos no repositório,
// mas usados pelo invasor): decisão do responsável em 09/11/2026, sem revisão manual.
// Plugins "parecidos" ainda desconhecidos: nome no padrão do kit (sufixo hexadecimal de 8 dígitos, timestamp
// 17781NNNNN, cloudflare-vN-NN) ou plugin pequeno cujo código é ofuscado e controlado pela requisição / se esconde.
const SUSPICIOUS_PLUGIN_NAME = /[-_][0-9a-f]{8}(?:-[0-9a-f]{8})?$|[-_]1[5-9]\d{8}$|^cloudflare-v\d+-\d+$/i;
const SMALL_PLUGIN_ENTRIES = 5;
const MAX_INSPECTED_PHP = 300 * 1024;
// Temas falsos do mesmo kit (ex.: category_template_1778142327, com webshells archlve.php e *_obfuscated_*.php).
const MALICIOUS_THEME = /^category_template_17781\d{5}$/;
// Logins criados pelo invasor, confirmados pelo responsável (09/11/2026: ninguém conhece "default_john_from_usa").
const MALICIOUS_LOGINS = /^default_john_from_usa$/i;
const REMOVABLE_DIRECTORY = /^wp-content\/(?:plugins|themes)\/[^/]+$/;
const PLAN_ONLY = process.argv.includes('--plan');

// Sites, caminhos, bancos e acessos vêm do .env (ver src/config.mjs).
// --site=<chave> limita o plano (e a execução) a um site; o painel passa o mesmo escopo nas duas etapas.
const SITE_KEY = siteArg();
const sites = selectSites(loadSites(), SITE_KEY);

const automaticFileMessages = new Set([
  'Arquivo PHP encontrado dentro de uploads',
  'Arquivo PHP oculto encontrado',
  'Arquivo PHP com extensão dupla',
  'webshell conhecido',
  'execução de carga codificada',
  'comando do sistema vindo da requisição',
  'assert controlado pela requisição',
  'include controlado pela requisição',
  'Arquivo conhecido de persistência maliciosa',
]);

await fs.mkdir(DATA_DIR, { recursive: true });
const state = await readJson(STATE_FILE);
let baseline = await readJson(BASELINE_FILE, null);
if (!baseline) {
  baseline = structuredClone(state);
  baseline.trustedAt = new Date().toISOString();
  await writeFileAtomic(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log('Baseline confiável criada a partir da última varredura validada.');
}

const alerts = await readJsonLines(ALERT_FILE);
// Pendente = depois da última limpeza que cobriu o site do alerta. Com --site, alertas de outros sites (e os gerais
// do monitor) ficam fora deste plano.
const lastCleanupOf = lastCleanupFinder(alerts);
const pendingAlerts = alerts.filter((event, index) => event.message !== 'cleanup_completed'
  && index > lastCleanupOf(event.site)
  && (!SITE_KEY || event.site === SITE_KEY));
// Plugins marcados na busca por arquivos (lista conhecida ou parecidos), por site: também saem da lista de ativos.
const flaggedPlugins = new Map();
const plan = {
  createdAt: new Date().toISOString(), scope: SITE_KEY ? [SITE_KEY] : null,
  fileActions: [], databaseActions: [], manualReview: [],
};

// Alertas de infraestrutura e conectividade não são artefatos maliciosos para limpeza de arquivos.
const ignoredInPlanMessages = new Set([
  'Arquivo monitorado foi removido',
  'Falha ao verificar o site',
  'Falha geral da varredura',
]);

for (const alert of pendingAlerts) {
  const site = sites.find((candidate) => candidate.key === alert.site);
  const relativePath = alert.details?.path;
  if (ignoredInPlanMessages.has(alert.message)) continue;
  const knownMaliciousPath = (
    /^(?:wp-content\/mu-plugins|wp-content\/plugins\/vapor-curator-tap)\/vapor-curator-tap\.php$/i.test(relativePath || '') ||
    /^(?:wp-content\/mu-plugins|wp-content\/plugins\/pulse-beacon-ops)\/pulse-beacon-ops\.php$/i.test(relativePath || '')
  );
  if (!site || !relativePath || (!automaticFileMessages.has(alert.message) && !knownMaliciousPath)) {
    if (alert.severity === 'high' || alert.severity === 'critical') plan.manualReview.push(alert);
    continue;
  }

  const trustedFile = baseline.sites?.[site.key]?.files?.[relativePath];
  if (trustedFile) {
    plan.manualReview.push({
      ...alert,
      reason: 'O caminho existia na baseline. É necessário restaurar uma cópia oficial, não apagar automaticamente.',
    });
    continue;
  }

  if (isSafeRemoteRelativePath(relativePath)) {
    plan.fileActions.push({ type: 'delete_file', site: site.key, path: relativePath, reason: alert.message });
  }
}

plan.fileActions.push(...await inspectMalwareMarkers());

const activeThemes = new Map();
for (const site of sites) {
  if (!site.db.enabled) continue;
  // Um banco inacessível vai para revisão manual e não impede o plano dos demais sites.
  try {
    const dbPlan = await inspectDatabaseForCleanup(site, baseline.sites?.[site.key] || {});
    plan.databaseActions.push(...dbPlan.actions);
    plan.manualReview.push(...dbPlan.manualReview);
    activeThemes.set(site.key, dbPlan.activeThemes);
  } catch (error) {
    plan.manualReview.push({ severity: 'critical', site: site.key, message: `Banco do site não verificado: ${error.code || error.message}` });
  }
}

// Tema nunca é apagado sem saber qual está ativo: apagar o tema em uso derruba o site.
plan.fileActions = plan.fileActions.filter((action) => {
  const theme = action.type === 'delete_directory' && action.path.match(/^wp-content\/themes\/([^/]+)$/)?.[1];
  if (!theme) return true;
  const active = activeThemes.get(action.site);
  if (active && !active.includes(theme)) return true;
  plan.manualReview.push({
    severity: 'critical', site: action.site, details: { path: action.path },
    message: active ? 'Tema malicioso é o tema ativo; troque o tema antes de apagar' : 'Tema malicioso não removido: tema ativo desconhecido (banco não verificado)',
  });
  return false;
});

// Cada varredura repete os alertas que continuam valendo (ex.: links ocultos na home): na revisão manual fica um item
// por problema, o mais recente, com os mesmos campos que distinguem itens no painel (makeItemKey).
const reviewKey = (item) => [item.site, item.message, item.details?.path, item.details?.header, item.details?.visto_como, item.details?.status, item.details?.hook, item.details?.postId].join('|');
plan.manualReview = [...new Map(plan.manualReview.map((item) => [reviewKey(item), item])).values()];
plan.fileActions = uniqueActions(plan.fileActions);
plan.databaseActions = uniqueActions(plan.databaseActions);
plan.id = crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 10).toUpperCase();
await writeFileAtomic(PLAN_FILE, `${JSON.stringify(plan, null, 2)}\n`);

printPlan(plan);
const actionCount = plan.fileActions.length + plan.databaseActions.length;
if (!actionCount) {
  console.log('\nNenhuma ação automática segura está pendente. Nada foi alterado.');
  if (!PLAN_ONLY) await writeCleanReport('nada-pendente');
  process.exit(0);
}

if (PLAN_ONLY) {
  console.log(`\nPlano somente-leitura. Para executar, use "Executar plano" na Central de Limpeza do painel (ou run-cleanup.cmd) e digite o código de confirmação que aparecer.`);
  process.exit(0);
}

const confirmation = `LIMPAR-${plan.id}`;
const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await terminal.question(`\nPara executar ${actionCount} ação(ões), digite exatamente ${confirmation}: `);
terminal.close();
if (answer.trim() !== confirmation) {
  console.log('Confirmação incorreta. Limpeza cancelada sem alterações.');
  await writeCleanReport('cancelada');
  process.exit(1);
}

const completed = [];
let verification = [];
try {
  await executeFileActions(plan.fileActions, completed);
  await executeDatabaseActions(plan.databaseActions, completed);
  verification = await verifyPublishedPages(completed);
} catch (error) {
  await writeCleanReport('erro', { completed, error });
  throw error;
}
await writeCleanReport('executada', { completed, verification });

const event = {
  timestamp: new Date().toISOString(), severity: 'info', site: 'monitor',
  message: 'cleanup_completed', details: { planId: plan.id, sites: sites.map((s) => s.key), completed, verification },
};
await fs.appendFile(ALERT_FILE, `${JSON.stringify(event)}\n`, 'utf8');
console.log(`\nLimpeza ${plan.id} concluída: ${completed.length} ação(ões). Execute a varredura novamente para validar.`);

// Seção do relatório diário (reports/REPORT-DD.MM.AA.txt) para esta execução da limpeza.
async function writeCleanReport(status, { completed = [], verification = [], error = null } = {}) {
  try {
    const labels = {
      delete_file: 'Arquivo removido', delete_directory: 'Pasta removida', delete_users: 'Usuários excluídos', delete_application_passwords: 'Application Passwords removidas',
      destroy_sessions: 'Sessões de login encerradas', disable_registration: 'Cadastro público desativado', delete_wpse_option: 'Opção wpse_user_id removida',
      restore_url: 'Endereço do site restaurado', remove_known_cron_hooks: 'Tarefas maliciosas removidas do WP-Cron', delete_malicious_options: 'Opções do malware removidas',
      remove_malicious_active_plugins: 'Plugins maliciosos retirados da lista de ativos', delete_malicious_snippets: 'Snippets maliciosos removidos',
      delete_spam_content: 'Spam removido', remove_hidden_links: 'Links externos ocultos removidos', delete_spam_revisions: 'Revisões com spam removidas',
    };
    const describe = (a) => {
      const extra = a.type === 'delete_file' || a.type === 'delete_directory' ? `${a.path} (${a.reason})`
        : a.type === 'delete_users' ? `${a.logins?.length ? `${a.logins.join(', ')} — ` : ''}IDs ${a.ids.join(', ')}`
          : a.type === 'remove_known_cron_hooks' ? a.hooks.join(', ')
            : a.type === 'remove_malicious_active_plugins' ? a.plugins.join(', ')
              : a.reason;
      return `${labels[a.type] || a.type}: ${extra}`;
    };
    const allActions = [...plan.fileActions, ...plan.databaseActions];
    const statusText = {
      'nada-pendente': 'NENHUMA AÇÃO NECESSÁRIA — nada foi alterado.',
      cancelada: `CANCELADA — confirmação incorreta; nada foi alterado (${allActions.length} ação(ões) propostas).`,
      executada: `EXECUTADA — ${completed.length} de ${allActions.length} ação(ões) concluídas.`,
      erro: `INTERROMPIDA POR ERRO — ${completed.length} de ${allActions.length} ação(ões) concluídas antes do erro: ${error?.message}`,
    }[status];
    const summary = [
      `Plano: ${plan.id}`,
      `Sites: ${sites.map((s) => `${s.name} (${new URL(s.url).hostname})`).join(', ')}`,
      '',
      `RESULTADO: ${statusText}`,
    ];
    const lines = [];
    const done = new Set(completed);
    for (const site of sites) {
      const proposed = allActions.filter((a) => a.site === site.key);
      const review = plan.manualReview.filter((m) => m.site === site.key);
      lines.push(`${site.name.toUpperCase()} — ${site.url}`, '');
      if (!proposed.length) lines.push(...bullet('Nenhuma ação automática necessária.'));
      for (const a of proposed) {
        const prefix = status === 'executada' || status === 'erro' ? (done.has(a) ? '' : '[NÃO EXECUTADA] ') : '[proposta] ';
        lines.push(...bullet(prefix + describe(a)));
      }
      for (const v of verification.filter((x) => x.site === site.key)) {
        lines.push(...bullet(`Conferência "${v.title}" (${v.agent || '-'}): ${v.error ? `falhou (${v.error})` : v.remaining.length ? `AINDA HÁ ${v.remaining.length} link(s) oculto(s)` : `HTTP ${v.status}, nenhum link oculto`}.`));
      }
      if (review.length) {
        lines.push('', `Revisão manual (${review.length}, não alterados automaticamente)`);
        for (const m of review.slice(0, 15)) lines.push(...bullet(`[${String(m.severity).toUpperCase()}] ${m.message}${m.details?.path ? ` — ${m.details.path}` : ''}`));
        if (review.length > 15) lines.push(...bullet(`… e mais ${review.length - 15}.`));
      }
      lines.push('');
    }
    if (status === 'executada' || status === 'erro') {
      const backups = (await fs.readdir(BACKUP_DIR).catch(() => [])).filter((f) => f.startsWith(`${plan.id}-`));
      lines.push('Backups (tudo o que foi alterado ou apagado pode ser restaurado)');
      lines.push(...(backups.length ? backups.map((f) => bullet(`.monitor-data/backups/${f}`)).flat() : bullet('Nenhum (ações sem dados a guardar).')));
    }
    const now = new Date();
    const file = await appendSection(REPORTS_DIR, { title: `LIMPEZA — ${dateBR(now)}, ${timeBR(now)} (horário de Brasília)`, summary, lines }, now);
    console.log(`Relatório: ${path.relative(ROOT_DIR, file)}`);
  } catch (reportError) {
    console.warn(`Relatório não gravado: ${reportError.message}`);
  }
}

async function inspectDatabaseForCleanup(site, trustedSite) {
  const actions = [];
  const manualReview = [];
  const prefix = assertPrefix(site.db.prefix);
  const connection = await openDatabase(site);
  try {
    const [users] = await connection.query(
      `SELECT u.ID, u.user_login, u.user_email, COALESCE(m.meta_value, '') AS capabilities
       FROM \`${prefix}users\` u
       LEFT JOIN \`${prefix}usermeta\` m ON m.user_id = u.ID AND m.meta_key = ?
       ORDER BY u.ID`,
      [`${prefix}capabilities`],
    );
    const trustedUsers = new Map((trustedSite.users || []).map((user) => [String(user.id), user]));
    const unexpectedUsers = [];
    const allowed = new Set((site.allowedUsers || []).map((login) => login.toLowerCase()));
    if (allowed.size) {
      // Lista de permitidos configurada no site: ela manda (não a baseline). Qualquer outro login é excluído e o
      // conteúdo dele vai para o primeiro permitido existente. Sem nenhum permitido no banco, nada é excluído.
      const keep = users.filter((u) => allowed.has(String(u.user_login).toLowerCase()));
      const remove = users.filter((u) => !allowed.has(String(u.user_login).toLowerCase()));
      if (!keep.length) {
        manualReview.push({ severity: 'critical', site: site.key, message: 'Nenhum usuário da lista de permitidos existe no banco; exclusão de usuários não proposta', details: { logins: [...allowed] } });
      } else if (remove.length) {
        actions.push({
          type: 'delete_users', site: site.key, ids: remove.map((u) => Number(u.ID)), logins: remove.map((u) => u.user_login),
          allowlist: true, keepLogins: keep.map((u) => u.user_login), reassignTo: Number(keep[0].ID),
          reason: `Fora da lista de usuários permitidos (${keep.map((u) => u.user_login).join(', ')}); conteúdo transferido para ${keep[0].user_login}`,
        });
      }
    }
    for (const user of allowed.size ? [] : users) {
      const id = String(user.ID);
      const trusted = trustedUsers.get(id);
      if (!trusted) unexpectedUsers.push(user);
      else if (MALICIOUS_LOGINS.test(user.user_login)) {
        // Está na baseline: a exclusão automática recusaria (proteção dos usuários confiáveis).
        manualReview.push({ severity: 'critical', site: site.key, message: 'Login do invasor está na baseline confiável; exclua manualmente e refaça a baseline', details: { id, login: user.user_login } });
      } else if (trusted.login !== user.user_login || trusted.email !== user.user_email || trusted.capabilities !== user.capabilities) {
        manualReview.push({
          severity: 'critical', site: site.key, message: 'Usuário existente alterado; restauração manual necessária',
          details: { id, currentLogin: user.user_login, currentEmail: user.user_email },
        });
      }
    }
    const usersAction = (list, reason) => ({ type: 'delete_users', site: site.key, ids: list.map((u) => Number(u.ID)), logins: list.map((u) => u.user_login), reason });
    if (allowed.size) {
      // Já tratado pela lista de permitidos.
    } else if (trustedUsers.size) {
      if (unexpectedUsers.length) actions.push(usersAction(unexpectedUsers, 'Usuários ausentes da baseline confiável'));
    } else {
      // Sem usuários na baseline confiável, todos pareceriam "novos" (inclusive os administradores legítimos): só os
      // logins confirmados como do invasor são excluídos; o resto vai para revisão manual.
      const malicious = unexpectedUsers.filter((u) => MALICIOUS_LOGINS.test(u.user_login));
      const others = unexpectedUsers.filter((u) => !MALICIOUS_LOGINS.test(u.user_login));
      if (malicious.length) actions.push(usersAction(malicious, 'Login criado pelo invasor (confirmado pelo responsável)'));
      if (others.length) {
        manualReview.push({ severity: 'high', site: site.key, message: 'Site sem usuários na baseline confiável; exclusão dos demais usuários não proposta', details: { ids: others.map((u) => Number(u.ID)), logins: others.map((u) => u.user_login) } });
      }
    }

    const [[appPasswords]] = await connection.query(
      `SELECT COUNT(*) AS total FROM \`${prefix}usermeta\` WHERE meta_key = '_application_passwords'`,
    );
    if (Number(appPasswords.total)) actions.push({ type: 'delete_application_passwords', site: site.key, reason: `${appPasswords.total} registro(s)` });

    // O malware abriu sessões válidas de administradores; a limpeza encerra todas, inclusive as legítimas.
    const [[sessions]] = await connection.query(
      `SELECT COUNT(*) AS total FROM \`${prefix}usermeta\` WHERE meta_key = 'session_tokens'`,
    );
    if (Number(sessions.total)) actions.push({ type: 'destroy_sessions', site: site.key, reason: `Encerrar todas as sessões de login (${sessions.total} usuário(s))` });

    const [options] = await connection.query(
      `SELECT option_name, option_value FROM \`${prefix}options\`
       WHERE option_name IN ('users_can_register', 'siteurl', 'home', 'wpse_user_id', 'cron', 'template', 'stylesheet')`,
    );
    const optionMap = Object.fromEntries(options.map((row) => [row.option_name, String(row.option_value || '')]));
    if (optionMap.users_can_register === '1') actions.push({ type: 'disable_registration', site: site.key, reason: 'Cadastro público ativo' });
    if (optionMap.wpse_user_id) actions.push({ type: 'delete_wpse_option', site: site.key, reason: 'Persistência wpse_user_id' });
    for (const optionName of ['siteurl', 'home']) {
      if (safeHostname(optionMap[optionName]) !== new URL(site.url).hostname) {
        actions.push({ type: 'restore_url', site: site.key, optionName, value: site.url, reason: 'Domínio divergente' });
      }
    }
    const knownBadHooks = [
      'ucow453w8ve76hghgr', 'tf5uwlmqvz1oes',         // vapor-curator-tap
      'l13v100arr7tr8mgzf', 'qdpghrhactc02xeoyy1', 'rjwnz_2f9iqolq', // pulse-beacon-ops
      'sc_cron_fetch',                                 // framework "SC" (reinfecção de 24/10/2026)
    ].filter((hook) => (optionMap.cron || '').includes(hook));
    if (knownBadHooks.length) {
      actions.push({ type: 'remove_known_cron_hooks', site: site.key, hooks: knownBadHooks, reason: 'Hooks maliciosos conhecidos' });
    }

    // Persistência do framework "SC" no banco: opções sc_*, cópias do payload com nome hexadecimal e wpeditor_*.
    const [malOptions] = await connection.query(
      `SELECT option_name FROM \`${prefix}options\` WHERE option_name REGEXP ?`,
      ['^(sc_|_transient_sc_|_transient_timeout_sc_|wpeditor_|wp_editor_)|^[0-9a-f]{10}$|^[0-9a-f]{12}$'],
    );
    if (malOptions.length) {
      actions.push({ type: 'delete_malicious_options', site: site.key, names: malOptions.map((o) => o.option_name), reason: `${malOptions.length} opção(ões) do malware` });
    }

    // Plugins maliciosos ainda listados como ativos (os arquivos já foram removidos).
    const [[activeRow]] = await connection.query(`SELECT option_value FROM \`${prefix}options\` WHERE option_name = 'active_plugins'`);
    const activePlugins = Object.values(unserialize(String(activeRow?.option_value || 'a:0:{}')));
    const flagged = flaggedPlugins.get(site.key) || new Set();
    const badActive = activePlugins.filter((file) => {
      const slug = String(file).split('/')[0].replace(/\.php$/i, '');
      return MALICIOUS_PLUGIN.test(slug) || flagged.has(slug);
    });
    if (badActive.length) {
      actions.push({ type: 'remove_malicious_active_plugins', site: site.key, plugins: badActive, reason: `${badActive.length} plugin(s) malicioso(s) na lista de ativos` });
    }

    // Snippets maliciosos do Code Snippets (executam PHP a partir do banco).
    const [tables] = await connection.query('SHOW TABLES');
    if (tables.map((t) => Object.values(t)[0]).includes(`${prefix}snippets`)) {
      const [snippets] = await connection.query(`SELECT id, name FROM \`${prefix}snippets\` WHERE name = 'Site Optimizer Bridge' OR code LIKE '%SITE_OPTIMIZER%'`);
      if (snippets.length) actions.push({ type: 'delete_malicious_snippets', site: site.key, ids: snippets.map((s) => s.id), reason: `Snippet(s) malicioso(s): ${snippets.map((s) => s.name).join(', ')}` });
    }

    // Spam publicado com credenciais roubadas, só nos sites com data de corte definida e verificada.
    const spamIds = new Set();
    if (site.spamContentSince) {
      const [spam] = await connection.query(
        `SELECT ID, post_type FROM \`${prefix}posts\` WHERE (post_type = 'post' AND post_date >= ?) OR (post_type = 'page' AND post_date >= ?)`,
        [site.spamContentSince.post, site.spamContentSince.page],
      );
      spam.forEach((s) => spamIds.add(Number(s.ID)));
      if (spam.length) {
        const posts = spam.filter((s) => s.post_type === 'post').length;
        actions.push({ type: 'delete_spam_content', site: site.key, ids: spam.map((s) => Number(s.ID)), reason: `Spam: ${posts} post(s) e ${spam.length - posts} página(s) criados após a data de corte` });
      }
    }

    // SEO spam: links externos em blocos posicionados fora da tela, no Elementor e no post_content.
    const siteHost = new URL(site.url).hostname;
    const [contentRows] = await connection.query(
      `SELECT p.ID, p.post_parent, p.post_title, p.post_type, p.post_content, m.meta_value AS elementor
       FROM \`${prefix}posts\` p
       LEFT JOIN \`${prefix}postmeta\` m ON m.post_id = p.ID AND m.meta_key = '_elementor_data'
       WHERE p.post_type <> 'attachment' AND (p.post_content LIKE '%position%' OR m.meta_value LIKE '%position%')`,
    );
    const hiddenPosts = [];
    const spamRevisions = [];
    for (const row of contentRows) {
      // O que já será apagado como spam (e suas revisões) fica fora desta etapa.
      if (spamIds.has(Number(row.ID)) || spamIds.has(Number(row.post_parent))) continue;
      const elementor = row.elementor ? String(row.elementor) : '';
      const inElementor = elementor ? scanElementorData(elementor, siteHost) : [];
      const inContent = findHiddenBlocks(String(row.post_content || ''), siteHost);
      if (!inElementor.length && !inContent.length) continue;
      if (row.post_type === 'revision') { spamRevisions.push(Number(row.ID)); continue; }
      if (inElementor.length && !cleanElementorRaw(elementor, siteHost).ok) {
        manualReview.push({ severity: 'critical', site: site.key, message: 'Links ocultos que não puderam ser removidos com segurança', details: { postId: row.ID, titulo: row.post_title } });
        continue;
      }
      hiddenPosts.push({
        id: Number(row.ID), title: row.post_title, postType: row.post_type, elementor: inElementor.length > 0, content: inContent.length > 0,
        hosts: [...new Set([...inElementor.flatMap((f) => f.hosts), ...inContent.flatMap((b) => b.hosts)])],
      });
    }
    if (hiddenPosts.length) {
      actions.push({
        type: 'remove_hidden_links', site: site.key, posts: hiddenPosts,
        reason: `Links externos ocultos em ${hiddenPosts.length} página(s)/post(s): ${hiddenPosts.map((p) => `"${p.title}"`).join(', ')}`,
      });
    }
    if (spamRevisions.length) {
      actions.push({ type: 'delete_spam_revisions', site: site.key, ids: spamRevisions, reason: `${spamRevisions.length} revisão(ões) com links ocultos` });
    }
    // Tema pai e tema filho em uso: o plano nunca apaga um deles.
    const activeThemes = [optionMap.template, optionMap.stylesheet].filter(Boolean);
    return { actions, manualReview, activeThemes };
  } finally {
    await connection.end();
  }
}

// Marcadores de controle gravados pelo malware na raiz, em wp-content e em mu-plugins (ex.: sc_GG0cQk,
// .sd_pulse-beacon-ops, z). Não têm código; o limite de tamanho evita apagar PHP oculto, que continua
// sendo tratado pelos alertas do monitor.
async function inspectMalwareMarkers() {
  const pool = sftpPool();
  const actions = [];
  try {
    for (const site of sites) {
      // Um site inacessível vai para revisão manual e não impede o plano dos demais.
      try {
        const sftp = await pool.get(site);
        for (const relativeDir of MARKER_DIRS) {
          const remoteDir = relativeDir ? `${site.remoteRoot}/${relativeDir}` : site.remoteRoot;
          if (!await sftp.exists(remoteDir)) continue;
          for (const entry of await sftp.list(remoteDir)) {
            if (!isMalwareMarker(entry.name, entry.size, entry.type)) continue;
            const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
            actions.push({ type: 'delete_file', site: site.key, path: rel, reason: 'Marcador de malware' });
          }
        }
        // Drop-ins e PHP solto em wp-content/cache: só o que for classificado como malicioso é removido.
        // Drop-in de origem desconhecida vai para revisão manual (pode ser de um plugin de cache legítimo).
        const candidates = [...DROPIN_FILES];
        const cacheDir = `${site.remoteRoot}/wp-content/cache`;
        if (await sftp.exists(cacheDir)) {
          for (const entry of await sftp.list(cacheDir)) {
            if (entry.type === '-' && isCacheRootPhp(`wp-content/cache/${entry.name}`)) candidates.push(`wp-content/cache/${entry.name}`);
          }
        }
        for (const rel of candidates) {
          const remote = `${site.remoteRoot}/${rel}`;
          if (!await sftp.exists(remote)) continue;
          const text = normalizeBuffer(await sftp.get(remote)).toString('latin1');
          const { verdict, reason } = classifyPhp(rel, text);
          if (verdict === 'malicious') {
            actions.push({ type: 'delete_file', site: site.key, path: rel, reason: `${isDropin(rel) ? 'Drop-in malicioso' : 'PHP malicioso em wp-content/cache'} (${reason})` });
          } else if (verdict === 'unknown') {
            plan.manualReview.push({ severity: 'high', site: site.key, message: `${isDropin(rel) ? 'Drop-in' : 'PHP em wp-content/cache'} sem origem reconhecida; confira antes de apagar`, details: { path: rel } });
          }
        }
        // Pastas de plugin/tema maliciosas: desativar não basta, porque os webshells dentro delas respondem por URL
        // direta. São apagadas inteiras (com backup); um tema só depois de confirmar que não é o ativo.
        for (const [kind, isMalicious] of [['plugins', (name) => MALICIOUS_PLUGIN.test(name)], ['themes', (name) => MALICIOUS_THEME.test(name)]]) {
          const dir = `${site.remoteRoot}/wp-content/${kind}`;
          if (!await sftp.exists(dir)) continue;
          for (const entry of await sftp.list(dir)) {
            const rel = `wp-content/${kind}/${entry.name}`;
            if (entry.type === 'd' && isMalicious(entry.name)) {
              actions.push({ type: 'delete_directory', site: site.key, path: rel, reason: kind === 'plugins' ? 'Plugin malicioso conhecido' : 'Tema malicioso conhecido' });
              if (kind === 'plugins') flagPlugin(site, entry.name);
            } else if (kind === 'plugins') {
              const suspicion = await suspiciousPlugin(sftp, `${dir}/${entry.name}`, entry);
              if (!suspicion) continue;
              actions.push({ type: entry.type === 'd' ? 'delete_directory' : 'delete_file', site: site.key, path: rel, reason: `Plugin parecido com o malware (${suspicion})` });
              flagPlugin(site, entry.name.replace(/\.php$/i, ''));
            }
          }
        }
      } catch (error) {
        plan.manualReview.push({ severity: 'critical', site: site.key, message: `Arquivos do site não verificados (SFTP): ${error.message}` });
        await pool.drop(site);
      }
    }
  } finally {
    await pool.close();
  }
  return actions;
}

// Plugin fora da lista conhecida que se parece com o kit do malware: pelo nome, ou (se for pequeno: até
// SMALL_PLUGIN_ENTRIES itens, sem subpastas; ou um .php solto em plugins/) pelo conteúdo dos PHP. Devolve o motivo.
async function suspiciousPlugin(sftp, remote, entry) {
  if (entry.type === 'd') {
    if (SUSPICIOUS_PLUGIN_NAME.test(entry.name)) return 'nome no padrão do malware';
    const entries = await sftp.list(remote);
    if (entries.length > SMALL_PLUGIN_ENTRIES || entries.some((e) => e.type === 'd')) return null;
    for (const file of entries.filter((e) => e.type === '-' && /\.php$/i.test(e.name) && e.size <= MAX_INSPECTED_PHP)) {
      const reason = malwareSignals(normalizeBuffer(await sftp.get(`${remote}/${file.name}`)).toString('latin1'));
      if (reason) return `${file.name}: ${reason}`;
    }
    return null;
  }
  if (entry.type === '-' && /\.php$/i.test(entry.name) && !/^(?:index|hello)\.php$/i.test(entry.name) && entry.size <= MAX_INSPECTED_PHP) {
    const reason = malwareSignals(normalizeBuffer(await sftp.get(remote)).toString('latin1'));
    return reason ? `${entry.name}: ${reason}` : null;
  }
  return null;
}

// Sinais fortes do kit (todos os plugins falsos do drlui614 batem em pelo menos um).
function malwareSignals(text) {
  if (/all_plugins|pre_current_active_plugins|Stealth Mode/i.test(text)) return 'se esconde da lista de plugins';
  const obfuscated = /gzinflate|gzuncompress|str_rot13|\beval\s*\(|create_function/i.test(text);
  if (obfuscated && /\$_(?:POST|GET|REQUEST|COOKIE)\b/.test(text)) return 'código ofuscado controlado pela requisição';
  if (obfuscated && text.split('\n').some((line) => line.length > 2000)) return 'código ofuscado em linha gigante';
  return null;
}

function flagPlugin(site, slug) {
  if (!flaggedPlugins.has(site.key)) flaggedPlugins.set(site.key, new Set());
  flaggedPlugins.get(site.key).add(slug);
}

// Uma conexão SFTP por credencial, aberta sob demanda e uma de cada vez (sites na mesma hospedagem
// compartilham a conexão; muitas conexões simultâneas fazem algumas hospedagens bloquear a porta 22).
function sftpPool() {
  const connections = new Map();
  return {
    async get(site) {
      const id = sftpKey(site);
      if (!connections.has(id)) {
        assertSftp(site);
        const client = new SftpClient(`wp-cleaner-${connections.size}`);
        await connectSftpWithRetry(client, site.sftp, {
          readyTimeout: 20000,
          maxAttempts: 3,
          baseDelayMs: 3000,
          onRetry: (attempt, max, reason, delayMs) => {
            console.warn(
              `[limpeza] ${site.name}: SFTP falhou (tentativa ${attempt}/${max} — ${reason}). ` +
              `Aguardando ${Math.round(delayMs / 1000)}s antes de tentar novamente...`,
            );
          },
        });
        connections.set(id, client);
      }
      return connections.get(id);
    },
    // Descarta a conexão de um site que falhou, para o próximo com a mesma credencial reconectar.
    async drop(site) {
      const id = sftpKey(site);
      if (connections.has(id)) {
        await connections.get(id).end().catch(() => {});
        connections.delete(id);
      }
    },
    async close() {
      for (const client of connections.values()) await client.end().catch(() => {});
    },
  };
}

async function executeFileActions(actions, completed) {
  if (!actions.length) return;
  const pool = sftpPool();
  try {
    for (const action of actions) {
      const site = sites.find((candidate) => candidate.key === action.site);
      if (!site || !isSafeRemoteRelativePath(action.path)) throw new Error('Caminho remoto inseguro recusado');
      const sftp = await pool.get(site);
      const remotePath = `${site.remoteRoot}/${action.path}`.replace(/\/+/g, '/');
      if (action.type === 'delete_directory') {
        if (!REMOVABLE_DIRECTORY.test(action.path)) throw new Error(`Pasta fora de wp-content/plugins|themes recusada: ${action.path}`);
        if (await sftp.exists(remotePath) !== 'd') continue;
        // Backup da pasta inteira, conferido arquivo a arquivo pela contagem, antes de apagar.
        const local = path.join(BACKUP_DIR, `${plan.id}-${site.key}-arquivos`, ...action.path.split('/'));
        const remoteFiles = await countRemoteFiles(sftp, remotePath);
        await fs.mkdir(local, { recursive: true });
        await sftp.downloadDir(remotePath, local);
        const localFiles = await countLocalFiles(local);
        if (localFiles !== remoteFiles) {
          throw new Error(`Backup incompleto de ${action.path} (${localFiles} de ${remoteFiles} arquivos); a pasta não foi apagada`);
        }
        await sftp.rmdir(remotePath, true);
        completed.push(action);
        console.log(`Pasta removida: ${site.name}/${action.path} (${remoteFiles} arquivo(s) no backup)`);
        continue;
      }
      if (await sftp.exists(remotePath)) {
        // Backup do arquivo antes de apagar: .monitor-data/backups/<plano>-<site>-arquivos/<caminho>.
        const local = path.join(BACKUP_DIR, `${plan.id}-${site.key}-arquivos`, ...action.path.split('/'));
        await fs.mkdir(path.dirname(local), { recursive: true });
        await fs.writeFile(local, normalizeBuffer(await sftp.get(remotePath)));
        await sftp.delete(remotePath, false);
        completed.push(action);
        console.log(`Removido: ${site.name}/${action.path}`);
      }
    }
  } finally {
    await pool.close();
  }
}

async function executeDatabaseActions(actions, completed) {
  for (const site of sites) {
    const siteActions = actions.filter((action) => action.site === site.key);
    if (!siteActions.length) continue;
    const prefix = assertPrefix(site.db.prefix);
    const connection = await openDatabase(site);
    await connection.beginTransaction();
    try {
      for (const action of siteActions) {
        if (action.type === 'delete_users') {
          const ids = action.ids.map(Number).filter(Number.isInteger);
          if (!ids.length) throw new Error('Exclusão de usuários sem IDs recusada');
          if (action.allowlist) {
            // Reconfere no banco, dentro da transação: nenhum excluído é permitido e o destino do conteúdo é permitido.
            const allowedNow = new Set((site.allowedUsers || []).map((login) => login.toLowerCase()));
            const [rows] = await connection.query(`SELECT ID, user_login FROM \`${prefix}users\` WHERE ID IN (?) FOR UPDATE`, [[...ids, action.reassignTo]]);
            if (rows.some((row) => ids.includes(Number(row.ID)) && allowedNow.has(String(row.user_login).toLowerCase()))) {
              throw new Error('Exclusão recusada: um dos usuários está na lista de permitidos');
            }
            const target = rows.find((row) => Number(row.ID) === Number(action.reassignTo));
            if (!target || !allowedNow.has(String(target.user_login).toLowerCase())) throw new Error('Exclusão recusada: usuário de destino do conteúdo não é permitido ou não existe');
          } else {
            const trustedIds = new Set((baseline.sites?.[site.key]?.users || []).map((user) => Number(user.id)));
            if (ids.some((id) => trustedIds.has(id))) throw new Error('Tentativa de remover usuário da baseline recusada');
          }
          const [userRows] = await connection.query(`SELECT * FROM \`${prefix}users\` WHERE ID IN (?)`, [ids]);
          const [userMeta] = await connection.query(`SELECT * FROM \`${prefix}usermeta\` WHERE user_id IN (?)`, [ids]);
          await writeBackup(site, 'usuarios', { users: userRows, usermeta: userMeta, reassignTo: action.reassignTo || null });
          if (action.reassignTo) {
            // Usuário legítimo sobrando: o conteúdo dele fica no site, com o autor permitido.
            await connection.query(`UPDATE \`${prefix}posts\` SET post_author = ? WHERE post_author IN (?)`, [action.reassignTo, ids]);
            await connection.query(`UPDATE \`${prefix}comments\` SET user_id = ? WHERE user_id IN (?)`, [action.reassignTo, ids]);
          } else {
            // Usuário do invasor: o conteúdo dele é spam e sai junto.
            const [posts] = await connection.query(`SELECT ID FROM \`${prefix}posts\` WHERE post_author IN (?)`, [ids]);
            const postIds = posts.map((post) => Number(post.ID));
            if (postIds.length) {
              await connection.query(`DELETE FROM \`${prefix}term_relationships\` WHERE object_id IN (?)`, [postIds]);
              await connection.query(`DELETE FROM \`${prefix}postmeta\` WHERE post_id IN (?)`, [postIds]);
              await connection.query(`DELETE FROM \`${prefix}posts\` WHERE ID IN (?)`, [postIds]);
            }
            await connection.query(
              `DELETE cm FROM \`${prefix}commentmeta\` cm INNER JOIN \`${prefix}comments\` c ON c.comment_ID = cm.comment_id WHERE c.user_id IN (?)`,
              [ids],
            );
            await connection.query(`DELETE FROM \`${prefix}comments\` WHERE user_id IN (?)`, [ids]);
          }
          await connection.query(`DELETE FROM \`${prefix}usermeta\` WHERE user_id IN (?)`, [ids]);
          await connection.query(`DELETE FROM \`${prefix}users\` WHERE ID IN (?)`, [ids]);
        } else if (action.type === 'delete_application_passwords') {
          await connection.query(`DELETE FROM \`${prefix}usermeta\` WHERE meta_key = '_application_passwords'`);
        } else if (action.type === 'destroy_sessions') {
          await connection.query(`DELETE FROM \`${prefix}usermeta\` WHERE meta_key = 'session_tokens'`);
        } else if (action.type === 'disable_registration') {
          await connection.query(`UPDATE \`${prefix}options\` SET option_value = '0' WHERE option_name = 'users_can_register'`);
        } else if (action.type === 'delete_wpse_option') {
          await connection.query(`DELETE FROM \`${prefix}options\` WHERE option_name = 'wpse_user_id'`);
        } else if (action.type === 'restore_url') {
          await connection.query(`UPDATE \`${prefix}options\` SET option_value = ? WHERE option_name = ?`, [action.value, action.optionName]);
        } else if (action.type === 'remove_known_cron_hooks') {
          const [rows] = await connection.query(`SELECT option_value FROM \`${prefix}options\` WHERE option_name = 'cron' FOR UPDATE`);
          const parsedCron = unserialize(String(rows[0]?.option_value || 'a:0:{}'));
          for (const timestamp of Object.keys(parsedCron)) {
            if (timestamp === 'version' || !parsedCron[timestamp] || typeof parsedCron[timestamp] !== 'object') continue;
            for (const hook of action.hooks) delete parsedCron[timestamp][hook];
            if (Object.keys(parsedCron[timestamp]).length === 0) delete parsedCron[timestamp];
          }
          const cleanedCron = serialize(parsedCron);
          for (const hook of action.hooks) {
            if (cleanedCron.includes(hook)) throw new Error(`Falha ao remover hook ${hook}`);
          }
          await connection.query(`UPDATE \`${prefix}options\` SET option_value = ? WHERE option_name = 'cron'`, [cleanedCron]);
        } else if (action.type === 'delete_malicious_options') {
          const [rows] = await connection.query(`SELECT * FROM \`${prefix}options\` WHERE option_name IN (?)`, [action.names]);
          await writeBackup(site, 'opcoes', rows);
          await connection.query(`DELETE FROM \`${prefix}options\` WHERE option_name IN (?)`, [action.names]);
        } else if (action.type === 'remove_malicious_active_plugins') {
          const [rows] = await connection.query(`SELECT option_value FROM \`${prefix}options\` WHERE option_name = 'active_plugins' FOR UPDATE`);
          await writeBackup(site, 'plugins-ativos', rows);
          const current = Object.values(unserialize(String(rows[0]?.option_value || 'a:0:{}')));
          const removed = new Set(action.plugins || []);
          const kept = [...new Set(current.filter((file) => !removed.has(file) && !MALICIOUS_PLUGIN.test(String(file).split('/')[0])))];
          await connection.query(`UPDATE \`${prefix}options\` SET option_value = ? WHERE option_name = 'active_plugins'`, [serialize(kept)]);
        } else if (action.type === 'delete_malicious_snippets') {
          const [rows] = await connection.query(`SELECT * FROM \`${prefix}snippets\` WHERE id IN (?)`, [action.ids]);
          await writeBackup(site, 'snippets', rows);
          await connection.query(`DELETE FROM \`${prefix}snippets\` WHERE id IN (?)`, [action.ids]);
        } else if (action.type === 'delete_spam_content') {
          if (!site.spamContentSince) throw new Error('Exclusão de spam recusada: site sem data de corte');
          const [children] = await connection.query(`SELECT ID FROM \`${prefix}posts\` WHERE post_parent IN (?) AND post_type IN ('revision', 'attachment')`, [action.ids]);
          const ids = [...new Set([...action.ids, ...children.map((c) => Number(c.ID))])];
          const [posts] = await connection.query(`SELECT * FROM \`${prefix}posts\` WHERE ID IN (?)`, [ids]);
          const [postmeta] = await connection.query(`SELECT * FROM \`${prefix}postmeta\` WHERE post_id IN (?)`, [ids]);
          const [terms] = await connection.query(`SELECT * FROM \`${prefix}term_relationships\` WHERE object_id IN (?)`, [ids]);
          await writeBackup(site, 'spam', { posts, postmeta, term_relationships: terms });
          await connection.query(
            `DELETE cm FROM \`${prefix}commentmeta\` cm INNER JOIN \`${prefix}comments\` c ON c.comment_ID = cm.comment_id WHERE c.comment_post_ID IN (?)`,
            [ids],
          );
          await connection.query(`DELETE FROM \`${prefix}comments\` WHERE comment_post_ID IN (?)`, [ids]);
          await connection.query(`DELETE FROM \`${prefix}term_relationships\` WHERE object_id IN (?)`, [ids]);
          await connection.query(`DELETE FROM \`${prefix}postmeta\` WHERE post_id IN (?)`, [ids]);
          await connection.query(`DELETE FROM \`${prefix}posts\` WHERE ID IN (?)`, [ids]);
        } else if (action.type === 'remove_hidden_links') {
          await removeHiddenLinks(connection, prefix, site, action);
        } else if (action.type === 'delete_spam_revisions') {
          const ids = action.ids.map(Number).filter(Number.isInteger);
          const [revisions] = await connection.query(`SELECT * FROM \`${prefix}posts\` WHERE ID IN (?) AND post_type = 'revision' FOR UPDATE`, [ids]);
          if (revisions.length !== ids.length) throw new Error('Exclusão de revisões recusada: algum ID não é revisão');
          const [revisionMeta] = await connection.query(`SELECT * FROM \`${prefix}postmeta\` WHERE post_id IN (?)`, [ids]);
          await writeBackup(site, 'revisoes', { posts: revisions, postmeta: revisionMeta });
          await connection.query(`DELETE FROM \`${prefix}postmeta\` WHERE post_id IN (?)`, [ids]);
          await connection.query(`DELETE FROM \`${prefix}posts\` WHERE ID IN (?) AND post_type = 'revision'`, [ids]);
        } else {
          throw new Error(`Ação desconhecida: ${action.type}`);
        }
        completed.push(action);
        console.log(`Banco ${site.name}: ${action.type}`);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }
  }
}

// Passos 1 a 3 do SEO spam: backup do conteúdo original, remoção dos blocos ocultos (Elementor e
// post_content) e descarte do cache de elementos do Elementor, que é regenerado na próxima visita.
async function removeHiddenLinks(connection, prefix, site, action) {
  const siteHost = new URL(site.url).hostname;
  const ids = action.posts.map((p) => p.id);
  const [posts] = await connection.query(`SELECT ID, post_title, post_content FROM \`${prefix}posts\` WHERE ID IN (?) FOR UPDATE`, [ids]);
  const [meta] = await connection.query(
    `SELECT meta_id, post_id, meta_key, meta_value FROM \`${prefix}postmeta\` WHERE post_id IN (?) AND meta_key IN ('_elementor_data', '_elementor_element_cache') FOR UPDATE`,
    [ids],
  );
  await writeBackup(site, 'conteudo', { posts, postmeta: meta });
  for (const post of posts) {
    const data = meta.find((m) => m.post_id === post.ID && m.meta_key === '_elementor_data');
    if (data && scanElementorData(String(data.meta_value), siteHost).length) {
      const result = cleanElementorRaw(String(data.meta_value), siteHost);
      if (!result.ok) throw new Error(`Não foi possível limpar o Elementor do post ${post.ID}: ${result.error}`);
      await connection.query(`UPDATE \`${prefix}postmeta\` SET meta_value = ? WHERE meta_id = ?`, [result.json, data.meta_id]);
    }
    const content = stripHiddenBlocks(String(post.post_content || ''), siteHost);
    if (content.removed.length) await connection.query(`UPDATE \`${prefix}posts\` SET post_content = ? WHERE ID = ?`, [content.html, post.ID]);
  }
  await connection.query(`DELETE FROM \`${prefix}postmeta\` WHERE post_id IN (?) AND meta_key = '_elementor_element_cache'`, [ids]);
}

async function writeBackup(site, kind, data) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${plan.id}-${site.key}-${kind}.json`);
  await fs.writeFile(file, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
  console.log(`Backup salvo: ${path.relative(ROOT_DIR, file)}`);
}

// Passo 5: confere o HTML publicado das páginas limpas (como navegador e como Googlebot).
async function verifyPublishedPages(actions) {
  const results = [];
  for (const action of actions.filter((a) => a.type === 'remove_hidden_links')) {
    const site = sites.find((s) => s.key === action.site);
    const host = new URL(site.url).hostname;
    for (const post of action.posts) {
      for (const agent of ['WordPress-External-Security-Monitor/1.0', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)']) {
        try {
          const query = post.postType === 'page' ? 'page_id' : 'p';
          const response = await fetch(`${site.url}/?${query}=${post.id}&nocache=${Date.now()}`, { headers: { 'user-agent': agent }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
          const remaining = findHiddenBlocks(await response.text(), host);
          results.push({ site: site.key, postId: post.id, title: post.title, agent: agent.includes('Googlebot') ? 'Googlebot' : 'navegador', status: response.status, remaining: remaining.flatMap((b) => b.hosts) });
        } catch (error) {
          results.push({ site: site.key, postId: post.id, title: post.title, error: error.message });
        }
      }
    }
  }
  for (const r of results) {
    console.log(`Verificação ${r.site} "${r.title}" (${r.agent || '-'}): ${r.error ? `falhou (${r.error})` : r.remaining.length ? `AINDA HÁ ${r.remaining.length} link(s) oculto(s): ${[...new Set(r.remaining)].join(', ')}` : `HTTP ${r.status}, nenhum link oculto`}`);
  }
  return results;
}

function printPlan(value) {
  console.log(`\nPlano ${value.id} — ${value.scope ? `só o site ${value.scope.join(', ')}` : 'todos os sites'}`);
  for (const action of value.fileActions) console.log(`  [${action.type === 'delete_directory' ? 'PASTA' : 'ARQUIVO'}] excluir ${action.site}/${action.path} — ${action.reason}`);
  for (const action of value.databaseActions) console.log(`  [BANCO] ${action.site}: ${action.type} — ${action.reason}`);
  if (value.manualReview.length) {
    console.log(`\nRevisão manual (${value.manualReview.length}):`);
    for (const item of value.manualReview.slice(0, 20)) console.log(`  [${String(item.severity).toUpperCase()}] ${item.site}: ${item.message}${item.details?.path ? ` — ${item.details.path}` : ''}`);
  }
}

function uniqueActions(actions) {
  const seen = new Set();
  return actions.filter((action) => {
    const key = action.type === 'delete_file' || action.type === 'delete_directory'
      ? `${action.type}|${action.site}|${action.path}`
      : action.type === 'delete_users'
        ? `${action.type}|${action.site}|${[...action.ids].sort((a, b) => a - b).join(',')}`
        : `${action.type}|${action.site}|${action.optionName || ''}|${(action.hooks || []).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Arquivos comuns numa pasta remota, recursivamente (links e especiais não entram: o backup não os copia, então
// uma pasta com eles nunca passa na conferência e não é apagada).
async function countRemoteFiles(sftp, dir) {
  let total = 0;
  for (const entry of await sftp.list(dir)) {
    if (entry.type === 'd') total += await countRemoteFiles(sftp, `${dir}/${entry.name}`);
    else if (entry.type === '-') total += 1;
  }
  return total;
}

async function countLocalFiles(dir) {
  return (await fs.readdir(dir, { withFileTypes: true, recursive: true })).filter((entry) => entry.isFile()).length;
}

function isSafeRemoteRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('..') && !value.includes('\\');
}

// O SFTP às vezes devolve o arquivo em pedaços (array de Buffers).
function normalizeBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.concat(value.map((part) => normalizeBuffer(part)));
  if (typeof value === 'string') return Buffer.from(value);
  throw new TypeError(`Resposta SFTP inesperada: ${Object.prototype.toString.call(value)}`);
}

function assertPrefix(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Prefixo de banco inválido: ${value}`);
  return value;
}

function openDatabase(site) {
  return mysql.createConnection({
    host: site.db.host, port: site.db.port, database: site.db.database,
    user: site.db.user, password: site.db.password, connectTimeout: 10000,
    ssl: site.db.ssl ? {} : undefined,
  });
}

function safeHostname(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (arguments.length > 1 && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readJsonLines(file) {
  try {
    return (await fs.readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

