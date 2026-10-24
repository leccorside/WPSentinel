// Detecção e remoção de links externos ocultos (SEO spam): blocos com position fixed/absolute
// e coordenada negativa grande que contêm link para outro domínio. Usado pelo monitor e pela limpeza.

const HIDDEN_OPEN = /<([a-z][a-z0-9]*)\b[^>]*\bstyle\s*=\s*(["'])(?:(?!\2).)*?position\s*:\s*(?:fixed|absolute)(?:(?!\2).)*?(?:top|left|right|bottom)\s*:\s*-\s*\d{3,}(?:\.\d+)?px(?:(?!\2).)*?\2[^>]*>/gis;
const HREF = /href\s*=\s*["'](https?:\/\/[^"'\s>]+)/gi;
const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);

export function externalHosts(html, siteHost) {
  const own = baseDomain(siteHost);
  const hosts = [];
  for (const m of html.matchAll(HREF)) {
    let host;
    try { host = new URL(m[1]).hostname.toLowerCase(); } catch { continue; }
    if (baseDomain(host) !== own) hosts.push(host);
  }
  return hosts;
}

// Retorna os blocos ocultos que contêm pelo menos um link externo: { start, end, tag, style, hosts }.
export function findHiddenBlocks(html, siteHost) {
  const blocks = [];
  HIDDEN_OPEN.lastIndex = 0;
  let m;
  while ((m = HIDDEN_OPEN.exec(html))) {
    const tag = m[1].toLowerCase();
    if (VOID_TAGS.has(tag)) continue;
    const end = matchingClose(html, tag, m.index + m[0].length);
    if (end < 0) continue;
    const hosts = externalHosts(html.slice(m.index, end), siteHost);
    if (hosts.length) {
      blocks.push({ start: m.index, end, tag, style: (m[0].match(/style\s*=\s*["']([^"']*)/i) || [])[1] || '', hosts });
      HIDDEN_OPEN.lastIndex = end;
    }
  }
  return blocks;
}

export function stripHiddenBlocks(html, siteHost) {
  const blocks = findHiddenBlocks(html, siteHost);
  if (!blocks.length) return { html, removed: [] };
  let out = '';
  let cursor = 0;
  for (const b of blocks) { out += html.slice(cursor, b.start); cursor = b.end; }
  out += html.slice(cursor);
  return { html: out, removed: blocks };
}

// Percorre o JSON do Elementor (_elementor_data). Retorna os achados por widget.
export function scanElementorData(json, siteHost) {
  const findings = [];
  let tree;
  try { tree = JSON.parse(json); } catch { return scanRaw(json, siteHost); }
  walkElements(tree, (el) => {
    for (const [key, value] of Object.entries(el.settings || {})) {
      if (typeof value !== 'string') continue;
      const blocks = findHiddenBlocks(value, siteHost);
      if (blocks.length) findings.push({ elementId: el.id, widget: el.widgetType || el.elType, setting: key, hosts: blocks.flatMap((b) => b.hosts), blocks: blocks.length });
    }
  });
  return findings;
}

// Remove os blocos ocultos editando o texto original do _elementor_data, sem recodificar o documento
// inteiro (a recodificação nem sempre reproduz o que o WordPress gravou). Widgets que ficam sem nenhum
// HTML (ex.: widget HTML inteiro do atacante) são retirados; um widget legítimo que tenha só um iframe
// ou script não é afetado. Retorna ok=false se não for possível editar com segurança; nesse caso nada
// deve ser gravado.
export function cleanElementorRaw(raw, siteHost) {
  let tree;
  try { tree = JSON.parse(raw); } catch { return { ok: false, error: 'conteúdo não é JSON' }; }
  const changes = [];
  const removedWidgets = [];
  walkElements(tree, (el) => {
    for (const [key, value] of Object.entries(el.settings || {})) {
      if (typeof value !== 'string') continue;
      const result = stripHiddenBlocks(value, siteHost);
      if (!result.removed.length) continue;
      const emptied = el.elType === 'widget' && !result.html.replace(/<!--[\s\S]*?-->/g, '').trim();
      changes.push({ elementId: el.id, setting: key, before: value, after: result.html, hosts: result.removed.flatMap((b) => b.hosts), emptied });
      if (emptied && !removedWidgets.includes(el.id)) removedWidgets.push(el.id);
    }
  });
  let out = raw;
  for (const ch of changes.filter((c) => !removedWidgets.includes(c.elementId))) {
    const encoded = encodedForms(ch.before).find((form) => out.includes(form));
    if (!encoded) return { ok: false, error: `valor do widget ${ch.elementId} não localizado no texto original` };
    const style = encoded === phpJsonEncode(ch.before) ? phpJsonEncode : encoded === JSON.stringify(ch.before) ? JSON.stringify : slashOnly;
    out = out.replace(encoded, () => style(ch.after));
  }
  for (const id of removedWidgets) {
    const span = objectSpan(out, id);
    if (!span) return { ok: false, error: `widget ${id} não localizado no texto original` };
    let [start, end] = span;
    if (out[end] === ',') end += 1; else if (out[start - 1] === ',') start -= 1;
    out = out.slice(0, start) + out.slice(end);
  }
  try { JSON.parse(out); } catch { return { ok: false, error: 'resultado não é JSON válido' }; }
  if (scanElementorData(out, siteHost).length) return { ok: false, error: 'ainda restam links ocultos depois da edição' };
  return { ok: true, json: out, removed: changes.map(({ elementId, setting, hosts }) => ({ elementId, setting, hosts })), removedWidgets };
}

function encodedForms(value) {
  return [...new Set([phpJsonEncode(value), JSON.stringify(value), slashOnly(value)])];
}

function slashOnly(value) {
  return JSON.stringify(value).replace(/\//g, '\\/');
}

// Localiza, no texto JSON, o objeto do elemento com o id informado: [início, fim).
function objectSpan(text, id) {
  const marker = text.search(new RegExp(`"id"\\s*:\\s*"${id}"`));
  if (marker < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = marker; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') { if (depth === 0) { start = i; break; } depth--; }
  }
  if (start < 0) return null;
  let inString = false;
  depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return [start, i + 1]; }
  }
  return null;
}

// Mesmo formato do json_encode do PHP (barras e caracteres não-ASCII escapados), como o Elementor grava.
function phpJsonEncode(value) {
  return JSON.stringify(value)
    .replace(/\//g, '\\/')
    .replace(/[^\x00-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function walkElements(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walkElements(n, fn)); return; }
  if (!node || typeof node !== 'object') return;
  if (node.elType) fn(node);
  if (Array.isArray(node.elements)) walkElements(node.elements, fn);
}

function scanRaw(text, siteHost) {
  const unescaped = text.replace(/\\"/g, '"').replace(/\\\//g, '/');
  const blocks = findHiddenBlocks(unescaped, siteHost);
  return blocks.length ? [{ elementId: null, widget: null, setting: null, hosts: blocks.flatMap((b) => b.hosts), blocks: blocks.length }] : [];
}

function matchingClose(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

function baseDomain(host) {
  const parts = String(host).toLowerCase().replace(/^www\./, '').split('.');
  const secondLevel = ['com', 'net', 'org', 'adv', 'gov', 'edu', 'co'];
  const n = parts.length >= 3 && secondLevel.includes(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}
