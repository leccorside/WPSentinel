// Padrão de segurança dos arquivos da raiz do WordPress, conferido pela varredura e aplicado pela limpeza:
// - .htaccess da raiz idêntico a templates/root.htaccess (só o destino do RewriteRule do WordPress e o RewriteBase
//   seguem o original do site; o bloco do cPanel com a versão do PHP é preservado se for só o handler);
// - wp-config.php com as constantes obrigatórias abaixo, com os valores esperados.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_HTACCESS = '.htaccess';
export const WP_CONFIG = 'wp-config.php';
export const HTACCESS_TEMPLATE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'root.htaccess');

// Valores aceitos (normalizados) e o valor gravado quando a constante falta ou está diferente.
// WP_AUTO_UPDATE_CORE aparece duas vezes no padrão do responsável (true e 'minor'): os dois são aceitos e, se faltar,
// entra true (o que já estava nos sites). Definir a mesma constante duas vezes gera aviso do PHP, por isso só uma.
export const REQUIRED_CONSTANTS = [
  { name: 'DISALLOW_FILE_EDIT', value: 'true' },
  { name: 'AUTOMATIC_UPDATER_DISABLED', value: 'false' },
  { name: 'WP_AUTO_UPDATE_CORE', value: 'true', accept: ['true', "'minor'"] },
  { name: 'FORCE_SSL_ADMIN', value: 'true' },
  { name: 'DISALLOW_FILE_MODS', value: 'true' },
  { name: 'AUTOSAVE_INTERVAL', value: '180' },
  { name: 'WP_POST_REVISIONS', value: '10' },
  { name: 'EMPTY_TRASH_DAYS', value: '15' },
  { name: 'WP_CRON_LOCK_TIMEOUT', value: '120' },
];

// .htaccess da raiz somente leitura (0444): impede que um plugin, o próprio WordPress ou um invasor sem acesso ao
// dono do arquivo o regravem. A limpeza libera a escrita só durante a própria gravação.
export const READ_ONLY_MODE = 0o444;
export const isReadOnly = (mode) => (Number(mode) & 0o222) === 0;
export const formatMode = (mode) => (Number(mode) & 0o777).toString(8).padStart(4, '0');

// wp-content/.htaccess: só protege o próprio arquivo (padrão do responsável, 13/11/2026).
export const WP_CONTENT_HTACCESS = 'wp-content/.htaccess';
export const WP_CONTENT_HTACCESS_CONTENT = [
  '# Proteção do arquivo .htaccess',
  '<Files .htaccess>',
  '    Order Allow,Deny',
  '    Deny from all',
  '</Files>',
  '',
].join('\n');

// null se o wp-content/.htaccess está igual ao padrão; senão, se falta ou difere.
export function checkWpContentHtaccess(current) {
  if (current === null) return { missing: true };
  return normalizeText(current) === WP_CONTENT_HTACCESS_CONTENT ? null : { missing: false };
}

let templateCache = null;
export function loadHtaccessTemplate() {
  templateCache ??= normalizeText(fs.readFileSync(HTACCESS_TEMPLATE_FILE, 'utf8'));
  return templateCache;
}

// Sem BOM, quebras LF, sem espaços no fim das linhas e sem linhas vazias no fim.
export function normalizeText(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '') + '\n';
}

const WP_RULE = /^(\s*RewriteRule\s+\.\s+)(\S+)(\s+\[L\]\s*)$/m;
const WP_BASE = /^(\s*RewriteBase\s+)(\S+)(\s*)$/m;
const CPANEL_BLOCK = /# php -- BEGIN cPanel-generated handler, do not edit\n[\s\S]*?# php -- END cPanel-generated handler, do not edit\n?/;
// Dentro do bloco do cPanel só é aceito o handler de versão do PHP (é o que o painel da hospedagem grava).
const CPANEL_SAFE_LINE = /^(?:\s*|#.*|<IfModule mime_module>|<\/IfModule>|\s*AddHandler application\/x-httpd-(?:ea-|alt-)?php\d*(?:___lsphp)?(?:\s+\.\w+)+|\s*AddType application\/x-httpd-(?:ea-|alt-)?php\d*(?:\s+\.\w+)+)$/;

// .htaccess esperado para o site: o modelo, com o destino do RewriteRule e o RewriteBase do original (ou do caminho
// da URL do site, se não houver original) e o bloco do cPanel do original quando ele só define a versão do PHP.
export function expectedRootHtaccess(current, siteUrl) {
  let expected = loadHtaccessTemplate();
  const original = current === null ? '' : normalizeText(current);
  const sitePath = (() => { try { return new URL(siteUrl).pathname.replace(/\/?$/, '/'); } catch { return '/'; } })();
  // Só aceita do original um destino que seja o index.php do WordPress (numa pasta, se o site estiver em subpasta):
  // um RewriteRule injetado apontando para outro arquivo não passa para o .htaccess novo.
  const originalTarget = original.match(WP_RULE)?.[2];
  const originalBase = original.match(WP_BASE)?.[2];
  const target = /^\/(?:[\w.-]+\/)*index\.php$/.test(originalTarget || '') ? originalTarget : `${sitePath}index.php`;
  const base = /^\/(?:[\w.-]+\/)*$/.test(originalBase || '') ? originalBase : sitePath;
  expected = expected.replace(WP_RULE, (_, a, _b, c) => `${a}${target}${c}`).replace(WP_BASE, (_, a, _b, c) => `${a}${base}${c}`);
  const cpanel = original.match(CPANEL_BLOCK)?.[0];
  if (cpanel && cpanel.split('\n').every((line) => CPANEL_SAFE_LINE.test(line))) {
    expected = expected.replace(CPANEL_BLOCK, cpanel.endsWith('\n') ? cpanel : `${cpanel}\n`);
  }
  return expected;
}

// Compara o .htaccess da raiz com o esperado. Devolve null se está igual; senão, as linhas a mais e a menos.
export function checkRootHtaccess(current, siteUrl) {
  const expected = expectedRootHtaccess(current, siteUrl);
  if (current === null) return { missing: true, expected, extra: [], absent: [] };
  if (normalizeText(current) === expected) return null;
  const lines = (text) => normalizeText(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const have = lines(current);
  const want = lines(expected);
  const cut = (line) => (line.length > 160 ? `${line.slice(0, 160)}…` : line);
  return {
    missing: false, expected,
    extra: have.filter((line) => !want.includes(line)).slice(0, 15).map(cut),
    absent: want.filter((line) => !have.includes(line)).slice(0, 15).map(cut),
    // Mesmas linhas em outra ordem (ou repetidas) também contam como diferença.
    reordered: have.length === want.length && have.every((line) => want.includes(line)),
  };
}

// Primeira definição ativa (fora de comentário) de cada constante obrigatória.
function findDefinitions(text) {
  const found = new Map();
  let inBlock = false;
  text.split('\n').forEach((line, index) => {
    let code = line;
    if (inBlock) {
      const end = code.indexOf('*/');
      if (end === -1) return;
      code = code.slice(end + 2);
      inBlock = false;
    }
    code = code.replace(/\/\*.*?\*\//g, '');
    const open = code.indexOf('/*');
    if (open !== -1) { inBlock = true; code = code.slice(0, open); }
    if (/^\s*(?:\/\/|#)/.test(code)) return;
    for (const match of code.matchAll(/\bdefine\s*\(\s*(['"])([A-Z_]+)\1\s*,\s*(.+?)\s*\)\s*;/g)) {
      if (!found.has(match[2])) found.set(match[2], { line: index, statement: match[0], value: match[3] });
    }
  });
  return found;
}

const normalizeValue = (value) => String(value).trim().replace(/"/g, "'").replace(/^(true|false)$/i, (v) => v.toLowerCase());

// Constantes faltando ou com valor diferente do padrão.
export function checkWpConfig(text) {
  const definitions = findDefinitions(String(text).replace(/\r\n?/g, '\n'));
  const missing = [];
  const wrong = [];
  for (const constant of REQUIRED_CONSTANTS) {
    const found = definitions.get(constant.name);
    if (!found) { missing.push(constant.name); continue; }
    const accepted = constant.accept || [constant.value];
    if (!accepted.includes(normalizeValue(found.value))) wrong.push({ name: constant.name, atual: found.value, esperado: constant.value });
  }
  return { missing, wrong };
}

// wp-config.php corrigido: troca os valores diferentes na própria linha e insere as que faltam antes do comentário
// "stop editing"/"pare de editar" (ou do require do wp-settings.php). Sem ponto seguro de inserção: null.
export function fixWpConfig(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const definitions = findDefinitions(lines.join('\n'));
  const { missing, wrong } = checkWpConfig(text);
  if (!missing.length && !wrong.length) return { content: text, missing, wrong };
  for (const item of wrong) {
    const found = definitions.get(item.name);
    lines[found.line] = lines[found.line].replace(found.statement, `define( '${item.name}', ${item.esperado} );`);
  }
  if (missing.length) {
    let at = lines.findIndex((line) => /\/\*.*(?:stop editing|pare de editar)/i.test(line));
    if (at === -1) at = lines.findIndex((line) => /require(?:_once)?[\s(]*ABSPATH\s*\.\s*['"]wp-settings\.php/i.test(line));
    if (at === -1) return null;
    const block = [
      // Só ASCII: o wp-config.php é regravado em latin1 para preservar os bytes do original.
      '/** WP Sentinel: parametros obrigatorios de seguranca e manutencao. */',
      ...REQUIRED_CONSTANTS.filter((c) => missing.includes(c.name)).map((c) => `define( '${c.name}', ${c.value} );`),
      '',
    ];
    lines.splice(at, 0, ...block);
  }
  const content = lines.join(eol);
  const after = checkWpConfig(content);
  if (after.missing.length || after.wrong.length) return null;
  return { content, missing, wrong };
}
