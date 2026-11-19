// Núcleo do WordPress conferido com os checksums oficiais (pedido do responsável em 19/11/2026), usado pela varredura e
// pela limpeza. A versão vem de wp-includes/version.php ($wp_version e, em pacote traduzido, $wp_local_package); os
// MD5 oficiais vêm de api.wordpress.org/core/checksums e ficam em .monitor-data/core-checksums/<versão>-<locale>.json.
// - Arquivo do núcleo igual ao oficial: alteração legítima (ex.: atualização automática), sem alerta nem revisão manual.
// - Diferente do oficial: alerta crítico; a limpeza restaura a cópia oficial (core.svn.wordpress.org/tags/<versão>,
//   conferida pelo MD5 antes de gravar).
// - PHP em wp-admin, wp-includes ou na raiz que não existe no pacote: alerta alto; a limpeza apaga se for malicioso,
//   senão revisão manual.
// wp-content fica de fora (temas em src/themes.mjs; plugins têm regra própria).

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = /^\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?$/;
const LOCALE = /^[a-z]{2,3}(?:_[A-Z]{2})?(?:_[a-z]+)?$/;
const PHP = /\.(?:php\d*|phtml|phar)$/i;

export const md5 = (buffer) => crypto.createHash('md5').update(buffer).digest('hex');

// Caminho que pertence ao núcleo (tudo fora de wp-content, menos o wp-config.php do site).
export const isCorePath = (rel) => !/^wp-content\//.test(rel) && rel !== 'wp-config.php';
// PHP em área do núcleo: wp-admin, wp-includes ou solto na raiz (menos wp-config.php).
export const isCoreAreaPhp = (rel) => PHP.test(rel) && rel !== 'wp-config.php' && (/^(?:wp-admin|wp-includes)\//.test(rel) || !rel.includes('/'));

export function parseVersionPhp(text) {
  const version = String(text).match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? null;
  const locale = String(text).match(/\$wp_local_package\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? null;
  return version ? { version, locale } : null;
}

export async function readCoreVersion(sftp, root) {
  try {
    return parseVersionPhp(toBuffer(await sftp.get(`${root}/wp-includes/version.php`)).toString('utf8'));
  } catch {
    return null;
  }
}

const memo = new Map();

// { files: Map(caminho → Set(md5 aceitos)), locales } ou { files: null, reason }. Junta en_US e o locale do pacote
// traduzido (os dois MD5 valem, ex.: version.php e readme traduzidos).
export async function coreChecksums(version, locale, cacheDir) {
  if (!VERSION.test(version || '')) return { files: null, reason: `versão do WordPress fora do padrão: ${version}` };
  const locales = [...new Set(['en_US', LOCALE.test(locale || '') ? locale : null].filter(Boolean))];
  const key = `${version}|${locales.join(',')}`;
  if (memo.has(key)) return memo.get(key);
  const files = new Map();
  const used = [];
  for (const loc of locales) {
    let sums;
    try {
      sums = await loadChecksums(version, loc, cacheDir);
    } catch (error) {
      // Falha de rede não fica guardada: a próxima consulta tenta de novo.
      return { files: null, reason: error.message };
    }
    if (!sums) continue;
    used.push(loc);
    for (const [rel, sum] of Object.entries(sums)) {
      if (!isCorePath(rel) || !/^[0-9a-f]{32}$/.test(sum)) continue;
      if (!files.has(rel)) files.set(rel, new Set());
      files.get(rel).add(sum);
    }
  }
  const result = files.size ? { files, locales: used } : { files: null, reason: `sem checksums oficiais para o WordPress ${version}` };
  memo.set(key, result);
  return result;
}

async function loadChecksums(version, locale, cacheDir) {
  const file = path.join(cacheDir, `${version}-${locale}.json`);
  const cached = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  if (cached) return cached.checksums;
  const url = `https://api.wordpress.org/core/checksums/1.0/?version=${encodeURIComponent(version)}&locale=${encodeURIComponent(locale)}`;
  const response = await fetch(url, { headers: { 'user-agent': 'wp-sentinel' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`api.wordpress.org respondeu HTTP ${response.status} para os checksums do WordPress ${version} (${locale})`);
  const body = await response.json();
  // Com uma versão só, a API devolve { checksums: { caminho: md5 } }; algumas respostas vêm por versão.
  let checksums = body?.checksums;
  if (checksums && typeof checksums[version] === 'object') checksums = checksums[version];
  if (!checksums || typeof checksums !== 'object') checksums = null;
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ version, locale, fetchedAt: new Date().toISOString(), checksums }));
  return checksums;
}

// Cópia oficial de um arquivo do núcleo, aceita só se o MD5 bater com um dos checksums oficiais.
export async function officialCoreFile(version, rel, md5s) {
  if (!VERSION.test(version || '') || !isCorePath(rel) || rel.includes('..')) return null;
  const url = `https://core.svn.wordpress.org/tags/${version}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'wp-sentinel' }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) return null;
    const content = Buffer.from(await response.arrayBuffer());
    return md5s.includes(md5(content)) ? content : null;
  } catch {
    return null;
  }
}

// Compara arquivos do site com os checksums. entries: Map(caminho → md5 ou null). Devolve os arquivos iguais ao
// oficial, os diferentes e os PHP em área do núcleo que não existem no pacote.
export function compareCore(official, entries) {
  const verified = [];
  const mismatched = [];
  const extras = [];
  for (const [rel, sum] of entries) {
    const accepted = official.get(rel);
    if (accepted) {
      if (!sum) continue;
      if (accepted.has(sum)) verified.push(rel);
      else mismatched.push(rel);
    } else if (isCoreAreaPhp(rel)) {
      extras.push(rel);
    }
  }
  const sort = (list) => list.sort((a, b) => a.localeCompare(b));
  return { verified: sort(verified), mismatched: sort(mismatched), extras: sort(extras) };
}

// Arquivos da raiz, de wp-admin e de wp-includes (recursivo): [{ rel, size, mtime }].
export async function listCoreFiles(sftp, root) {
  const out = [];
  const walk = async (rel, recursive) => {
    for (const entry of await sftp.list(rel ? `${root}/${rel}` : root)) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.type === 'd') {
        if (recursive) await walk(child, true);
      } else if (entry.type === '-') {
        out.push({ rel: child, size: entry.size, mtime: entry.modifyTime });
      }
    }
  };
  await walk('', false);
  for (const dir of ['wp-admin', 'wp-includes']) {
    if (await sftp.exists(`${root}/${dir}`)) await walk(dir, true);
  }
  return out;
}

export async function mapLimit(items, limit, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

export function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.concat(value.map(toBuffer));
  return Buffer.from(String(value));
}
