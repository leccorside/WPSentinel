// Análise dos PHP de wp-content/themes (pedido do responsável em 13/11/2026), usada pela varredura e pela limpeza.
// - Tema do repositório oficial (pasta = slug do wordpress.org e Version do style.css com pacote publicado): cada PHP
//   é comparado por SHA-256 com o pacote da mesma versão. Diferente com sinal de malware → a limpeza restaura a cópia
//   oficial; diferente sem sinal (pode ser personalização) → revisão manual; a mais → apagado se for malicioso, senão
//   revisão manual.
// - Tema fora do repositório (premium, filho, feito sob medida): o conteúdo de cada PHP é classificado; malicioso ou
//   suspeito vai para revisão manual, porque não há cópia oficial para restaurar.
// Os pacotes baixados ficam em .monitor-data/official-themes/<slug>.<versão>.zip (baixados uma vez por versão).

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { phpMalwareSignal } from './mu-plugins.mjs';

export const THEMES_DIR = 'wp-content/themes';
export const THEME_PHP_MAX_BYTES = 1024 * 1024;
// Abaixo disso, o tema com a mesma pasta de um tema oficial é tratado como outro tema (ex.: premium com o mesmo nome),
// para a limpeza nunca sobrescrever um tema inteiro com arquivos que não são dele.
const OFFICIAL_MATCH_RATIO = 0.5;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const VERSION = /^[0-9][0-9a-z.+-]*$/i;
const SUSPICIOUS = /all_plugins|pre_current_active_plugins|Stealth Mode/i;
const MAX_LINE = 5000;

export const isThemePhp = (rel) => /^wp-content\/themes\/[^/]+\/.+\.(?:php\d*|phtml|phar)$/i.test(rel);
export const themeSlugOf = (rel) => rel.match(/^wp-content\/themes\/([^/]+)\//)?.[1] ?? null;
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// Cabeçalho do style.css: nome, versão e tema pai (Template, só em tema filho).
export function parseThemeHeader(css) {
  const head = String(css).slice(0, 8192);
  const field = (name) => head.match(new RegExp(`^[ \\t/*#@]*${name}:(.*)$`, 'mi'))?.[1].trim().replace(/\s*\*\/.*$/, '') || null;
  return { name: field('Theme Name'), version: field('Version'), template: field('Template') };
}

// Leitor mínimo de ZIP (diretório central; métodos store e deflate), sem dependência nova.
export function readZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('ZIP inválido (sem diretório central)');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP inválido (entrada do diretório central)');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`ZIP inválido (cabeçalho local de ${name})`);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`ZIP com compressão não suportada (${method}) em ${name}`);
    if (data.length !== size) throw new Error(`ZIP corrompido: tamanho de ${name} não confere`);
    files.set(name, data);
  }
  return files;
}

const packages = new Map();

// Pacote oficial do tema: { files: Map(caminho dentro do tema → Buffer), hashes: Map(caminho → sha256) } ou
// { files: null, reason } quando não há pacote (tema fora do repositório, versão não publicada, falha de rede).
export async function officialThemePackage(slug, version, cacheDir) {
  if (!SLUG.test(slug || '') || !VERSION.test(version || '')) return { files: null, reason: 'slug ou versão fora do padrão do wordpress.org' };
  const key = `${slug}.${version}`;
  if (packages.has(key)) return packages.get(key);
  const result = await loadPackage(slug, version, cacheDir).catch((error) => ({ files: null, reason: error.message }));
  // Falha de rede não fica guardada: a próxima consulta tenta de novo.
  if (result.files || result.permanent) packages.set(key, result);
  return result;
}

async function loadPackage(slug, version, cacheDir) {
  const file = path.join(cacheDir, `${slug}.${version}.zip`);
  let zip = await fs.readFile(file).catch(() => null);
  if (!zip) {
    const url = `https://downloads.wordpress.org/theme/${slug}.${version}.zip`;
    const response = await fetch(url, { headers: { 'user-agent': 'wp-sentinel' }, signal: AbortSignal.timeout(60000) });
    if (response.status === 404) return { files: null, permanent: true, reason: `sem pacote ${slug} ${version} no wordpress.org` };
    if (!response.ok) throw new Error(`wordpress.org respondeu HTTP ${response.status} para ${slug} ${version}`);
    zip = Buffer.from(await response.arrayBuffer());
    if (zip.length > MAX_PACKAGE_BYTES) throw new Error(`pacote ${slug} ${version} grande demais`);
  }
  const prefix = `${slug}/`;
  const files = new Map();
  for (const [name, data] of readZip(zip)) {
    if (!name.startsWith(prefix)) return { files: null, permanent: true, reason: `pacote ${slug} ${version} com pasta inesperada (${name})` };
    files.set(name.slice(prefix.length), data);
  }
  if (!files.has('style.css')) return { files: null, permanent: true, reason: `pacote ${slug} ${version} sem style.css` };
  // Só grava o ZIP no cache depois de conferir que ele abre.
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, zip);
  return { files, hashes: new Map([...files].map(([name, data]) => [name, sha256(data)])) };
}

// Sinal suspeito (não malicioso o bastante para apagar sozinho) num PHP de tema.
function themeSuspicion(text) {
  if (SUSPICIOUS.test(text)) return 'mexe na lista de plugins';
  const longest = text.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
  if (longest > MAX_LINE) return `linha com ${longest} caracteres (possível ofuscação)`;
  return null;
}

// Arquivos PHP de wp-content/themes, recursivamente: [{ rel, size, mtime }].
export async function listThemePhp(sftp, root) {
  const out = [];
  const walk = async (rel) => {
    for (const entry of await sftp.list(`${root}/${rel}`)) {
      const child = `${rel}/${entry.name}`;
      if (entry.type === 'd') await walk(child);
      else if (entry.type === '-' && isThemePhp(child)) out.push({ rel: child, size: entry.size, mtime: entry.modifyTime });
    }
  };
  if (await sftp.exists(`${root}/${THEMES_DIR}`)) await walk(THEMES_DIR);
  return out;
}

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// Analisa os temas do site. files: PHP de wp-content/themes ({ rel, size, mtime }). knownHash(file): SHA-256 já
// conhecido (state.json) ou null para baixar. shouldInspect(file): em tema não oficial, se o conteúdo deve ser
// classificado agora (a varredura só olha o que mudou, salvo no ciclo de hash completo; a limpeza olha tudo).
export async function analyzeThemes({ sftp, root, files, cacheDir, knownHash = () => null, shouldInspect = () => true, skip = () => false }) {
  const bySlug = new Map();
  for (const file of files) {
    const slug = themeSlugOf(file.rel);
    if (!slug || skip(slug)) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(file);
  }
  const results = [];
  for (const [slug, list] of bySlug) {
    const contents = new Map();
    const read = async (rel) => {
      if (!contents.has(rel)) contents.set(rel, toBuffer(await sftp.get(`${root}/${rel}`)));
      return contents.get(rel);
    };
    const header = await sftp.get(`${root}/${THEMES_DIR}/${slug}/style.css`).then((b) => parseThemeHeader(toBuffer(b).toString('utf8'))).catch(() => ({}));
    const result = {
      slug, name: header.name || null, version: header.version || null, child: Boolean(header.template),
      official: false, packageReason: null, modified: [], extra: [], malicious: [], suspicious: [], skipped: [],
    };
    results.push(result);
    const inspectable = list.filter((file) => {
      if (file.size <= THEME_PHP_MAX_BYTES) return true;
      result.skipped.push(file.rel);
      return false;
    });
    const pkg = header.version ? await officialThemePackage(slug, header.version, cacheDir) : { files: null, reason: 'style.css sem Version' };
    result.packageReason = pkg.reason || null;
    if (pkg.files) {
      const prefix = `${THEMES_DIR}/${slug}/`;
      const differs = [];
      const extras = [];
      let inPackage = 0;
      await mapLimit(inspectable, 4, async (file) => {
        const official = pkg.hashes.get(file.rel.slice(prefix.length));
        if (!official) { extras.push(file); return; }
        inPackage += 1;
        const hash = knownHash(file) || sha256(await read(file.rel));
        if (hash !== official) differs.push(file);
      });
      const matched = inPackage - differs.length;
      if (inPackage && matched / inPackage >= OFFICIAL_MATCH_RATIO) {
        result.official = true;
        for (const file of differs.sort((a, b) => a.rel.localeCompare(b.rel))) {
          const motivo = phpMalwareSignal((await read(file.rel)).toString('latin1'));
          result.modified.push({ path: file.rel, motivo });
          if (motivo) result.malicious.push({ path: file.rel, motivo });
        }
        for (const file of extras.sort((a, b) => a.rel.localeCompare(b.rel))) {
          const text = (await read(file.rel)).toString('latin1');
          const motivo = phpMalwareSignal(text);
          result.extra.push({ path: file.rel, motivo, suspeita: motivo ? null : themeSuspicion(text) });
          if (motivo) result.malicious.push({ path: file.rel, motivo });
        }
        continue;
      }
      result.packageReason = `só ${matched} de ${inPackage} PHP iguais ao pacote oficial ${slug} ${header.version}; tratado como tema fora do repositório`;
    }
    await mapLimit(inspectable.filter(shouldInspect), 4, async (file) => {
      const text = (await read(file.rel)).toString('latin1');
      const motivo = phpMalwareSignal(text);
      if (motivo) { result.malicious.push({ path: file.rel, motivo }); return; }
      const suspeita = themeSuspicion(text);
      if (suspeita) result.suspicious.push({ path: file.rel, motivo: suspeita });
    });
    result.malicious.sort((a, b) => a.path.localeCompare(b.path));
    result.suspicious.sort((a, b) => a.path.localeCompare(b.path));
  }
  return results;
}

// Alertas da varredura para o resultado de um tema (repetidos a cada ciclo enquanto o problema existir).
export function themeFindings(result) {
  const findings = [];
  const label = { tema: result.slug, versao: result.version };
  const cap = (list) => list.slice(0, 15);
  if (result.official && (result.modified.length || result.extra.length)) {
    findings.push({
      severity: result.malicious.length ? 'critical' : 'high', message: 'Tema difere do pacote oficial',
      details: { ...label, alterados: cap(result.modified.map((f) => f.path)), a_mais: cap(result.extra.map((f) => f.path)), maliciosos: cap(result.malicious), total_alterados: result.modified.length, total_a_mais: result.extra.length },
    });
  }
  if (!result.official && result.malicious.length) {
    findings.push({ severity: 'critical', message: 'PHP malicioso em tema', details: { ...label, arquivos: cap(result.malicious), total: result.malicious.length } });
  }
  if (!result.official && result.suspicious.length) {
    findings.push({ severity: 'high', message: 'PHP suspeito em tema', details: { ...label, arquivos: cap(result.suspicious), total: result.suspicious.length } });
  }
  return findings;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.concat(value.map(toBuffer));
  return Buffer.from(String(value));
}
