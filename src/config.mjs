import fs from 'node:fs';
import path from 'node:path';

// Configuração dos sites a partir de sites.json (painel) com fallback transparente para o .env.
export function loadSites(source = process.env, customDataDir = null) {
  const rootDir = process.cwd();
  const dir = customDataDir || dataPaths(rootDir, source).dataDir;
  const sitesFile = path.join(dir, 'sites.json');

  if (fs.existsSync(sitesFile)) {
    try {
      const content = fs.readFileSync(sitesFile, 'utf8');
      const list = JSON.parse(content);
      if (Array.isArray(list) && list.length > 0) {
        return list.map((s) => sanitizeSite(s));
      }
    } catch (err) {
      console.warn(`Aviso ao ler ${sitesFile}: ${err.message}. Tentando carregar do .env...`);
    }
  }

  // Fallback: lê variáveis do .env
  const env = (name) => {
    const value = source[name];
    return value === undefined || value === '' ? undefined : value;
  };
  const prefixes = (env('SITES') || '').split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (!prefixes.length) throw new Error('Nenhum site configurado. Adicione sites no painel ou defina SITES no .env.');

  const invalid = prefixes.filter((p) => !/^[A-Z][A-Z0-9_]*$/.test(p));
  if (invalid.length) throw new Error(`SITES: use só letras, números e _ nos prefixos, começando por letra (inválido: ${invalid.join(', ')}).`);
  const keys = new Set();
  const loaded = prefixes.map((p) => {
    const missing = ['URL', 'REMOTE_ROOT'].filter((field) => !env(`${p}_${field}`));
    if (missing.length) throw new Error(`Site ${p}: faltam no .env ${missing.map((field) => `${p}_${field}`).join(', ')}.`);
    const url = env(`${p}_URL`).replace(/\/+$/, '');
    try { new URL(url); } catch { throw new Error(`Site ${p}: ${p}_URL inválida (${url}).`); }
    const remoteRoot = env(`${p}_REMOTE_ROOT`).trim().replace(/\/+$/, '');
    if (!remoteRoot.startsWith('/') || remoteRoot.includes('..')) {
      throw new Error(`Site ${p}: ${p}_REMOTE_ROOT deve ser um caminho absoluto, sem "..", e diferente de "/" (ex.: /home/usuario/public_html).`);
    }
    const key = (env(`${p}_KEY`) || p.toLowerCase()).trim();
    if (!/^[a-z0-9_-]+$/i.test(key) || keys.has(key)) throw new Error(`Site ${p}: ${p}_KEY inválida ou repetida (${key}).`);
    keys.add(key);
    const sftp = {
      host: env(`${p}_SFTP_HOST`) || env('SFTP_HOST'),
      port: Number(env(`${p}_SFTP_PORT`) || env('SFTP_PORT') || 22),
      username: env(`${p}_SFTP_USER`) || env('SFTP_USER'),
      password: env(`${p}_SFTP_PASSWORD`) || env('SFTP_PASSWORD'),
    };
    const sinceErrors = ['POST', 'PAGE'].filter((t) => env(`${p}_SPAM_SINCE_${t}`) && !/^\d{4}-\d{2}-\d{2}$/.test(env(`${p}_SPAM_SINCE_${t}`)));
    if (sinceErrors.length) throw new Error(`Site ${p}: use AAAA-MM-DD em ${sinceErrors.map((t) => `${p}_SPAM_SINCE_${t}`).join(', ')}.`);
    return {
      key,
      envPrefix: p,
      name: env(`${p}_NAME`) || new URL(url).hostname,
      url,
      remoteRoot,
      sftp,
      db: {
        enabled: Boolean(env(`${p}_DB_HOST`)),
        envPrefix: p,
        host: env(`${p}_DB_HOST`),
        port: Number(env(`${p}_DB_PORT`) || 3306),
        database: env(`${p}_DB_NAME`),
        user: env(`${p}_DB_USER`),
        password: env(`${p}_DB_PASSWORD`),
        prefix: env(`${p}_DB_PREFIX`) || 'wp_',
        ssl: env(`${p}_DB_SSL`) === 'true',
      },
      spamContentSince: env(`${p}_SPAM_SINCE_POST`) || env(`${p}_SPAM_SINCE_PAGE`)
        ? { post: env(`${p}_SPAM_SINCE_POST`) || '9999-12-31', page: env(`${p}_SPAM_SINCE_PAGE`) || '9999-12-31' }
        : null,
    };
  });

  // Salva automaticamente para sites.json na primeira leitura do .env
  try {
    fs.writeFileSync(sitesFile, JSON.stringify(loaded, null, 2), 'utf8');
  } catch {}

  return loaded;
}

export function sanitizeSite(s) {
  const url = String(s.url || '').trim().replace(/\/+$/, '');
  try { new URL(url); } catch { throw new Error(`URL do site inválida: ${url}`); }
  const remoteRoot = String(s.remoteRoot || '').trim().replace(/\/+$/, '');
  if (!remoteRoot.startsWith('/') || remoteRoot.includes('..')) {
    throw new Error(`Caminho remoto inválido para ${s.key}: deve ser absoluto e sem "..".`);
  }
  const key = String(s.key || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(key)) {
    throw new Error(`Identificador do site inválido: "${key}". Use apenas letras, números e hífens.`);
  }

  return {
    key,
    envPrefix: s.envPrefix || key.toUpperCase(),
    name: s.name || new URL(url).hostname,
    url,
    remoteRoot,
    sftp: {
      host: s.sftp?.host || '',
      port: Number(s.sftp?.port || 22),
      username: s.sftp?.username || '',
      password: s.sftp?.password || '',
    },
    db: {
      enabled: Boolean(s.db?.enabled && s.db?.host),
      envPrefix: s.db?.envPrefix || key.toUpperCase(),
      host: s.db?.host || '',
      port: Number(s.db?.port || 3306),
      database: s.db?.database || '',
      user: s.db?.user || '',
      password: s.db?.password || '',
      prefix: s.db?.prefix || 'wp_',
      ssl: Boolean(s.db?.ssl),
    },
    spamContentSince: s.spamContentSince || null,
  };
}

export function saveSites(sites, dataDir = null) {
  if (!Array.isArray(sites)) throw new Error('A lista de sites deve ser um array.');
  const targetDir = dataDir || (process.env.DATA_DIR ? path.resolve(process.cwd(), process.env.DATA_DIR) : path.resolve(process.cwd(), '.monitor-data'));
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const sanitized = sites.map((s) => sanitizeSite(s));
  const sitesFile = path.join(targetDir, 'sites.json');
  fs.writeFileSync(sitesFile, JSON.stringify(sanitized, null, 2), 'utf8');
  return sanitized;
}

// Pastas de dados e relatórios: padrão dentro do projeto; DATA_DIR e REPORTS_DIR (absolutos ou relativos à raiz
// do projeto) permitem mudar o lugar, por exemplo numa VPS.
export function dataPaths(rootDir, source = process.env) {
  const resolve = (value, fallback) => path.resolve(rootDir, value || fallback);
  return { dataDir: resolve(source.DATA_DIR, '.monitor-data'), reportsDir: resolve(source.REPORTS_DIR, 'reports') };
}

// Uma conexão SFTP por credencial: sites na mesma hospedagem compartilham a conexão.
export function sftpKey(site) {
  return `${site.sftp.username}@${site.sftp.host}:${site.sftp.port}`;
}

export function assertSftp(site) {
  const missing = ['host', 'username', 'password'].filter((f) => !site.sftp[f]);
  if (missing.length) throw new Error(`Site ${site.envPrefix}: SFTP incompleto (defina SFTP_* ou ${site.envPrefix}_SFTP_*).`);
}
