// Drop-ins do WordPress e PHP solto em wp-content/cache. O WordPress carrega os drop-ins em toda requisição, sem
// plugin ativo; em 24/10/2026 eles eram a fonte da reinfecção (db.php e advanced-cache.php com o framework "SC").
// Plugins legítimos de cache e diagnóstico também criam esses arquivos, por isso o conteúdo é classificado.
// Usado pelo monitor (alertas) e pela limpeza (remoção só do que for malicioso).

export const DROPIN_FILES = ['wp-content/db.php', 'wp-content/advanced-cache.php', 'wp-content/object-cache.php'];

// Assinaturas do malware encontrado e padrões clássicos de carga ofuscada.
const MALWARE = /SC_(?:DB|ADV)_BEGIN|SCOCV:|SCV:\d|__scf_|\$GLOBALS\[['"]__|eval\s*\(\s*(?:base64_decode|gzinflate|gzuncompress|str_rot13)\s*\(|(?:\\x[0-9a-f]{2}){12}/i;

// Origens legítimas conhecidas (texto que esses plugins gravam no próprio drop-in).
const KNOWN_OWNERS = /W3 Total Cache|WP Super Cache|WP-Cache|LiteSpeed|Redis Object Cache|Object Cache Pro|wp-redis|Query Monitor|WP Rocket|Memcached|HyperDB|LudicrousDB|Docket Cache|SiteGround|SG Optimizer|Breeze|WP Fastest Cache|Cache Enabler|Comet Cache|Batcache|APCu|Hummingbird|Swift Performance|Perfmatters|WP Engine|Pressable|Atomic Edge/i;

const MAX_LINE = 5000; // linhas gigantes indicam código ofuscado; drop-ins legítimos não são minificados

export function isDropin(rel) {
  return DROPIN_FILES.includes(rel);
}

// PHP diretamente em wp-content/cache (não em subpastas, onde plugins de cache guardam os próprios arquivos).
export function isCacheRootPhp(rel) {
  return /^wp-content\/cache\/[^/]+\.(?:php\d*|phtml|phar)$/i.test(rel);
}

// Retorna { verdict: 'malicious' | 'known' | 'unknown', reason }.
export function classifyPhp(rel, text) {
  const signature = text.match(MALWARE)?.[0];
  if (signature) return { verdict: 'malicious', reason: `assinatura de malware: ${signature.slice(0, 40)}` };
  const longest = text.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
  if (longest > MAX_LINE) return { verdict: 'malicious', reason: `código ofuscado (linha com ${longest} caracteres)` };
  // O malware gravava em wp-content/cache arquivos com nome de 8 caracteres hexadecimais.
  if (isCacheRootPhp(rel) && /\/[0-9a-f]{8}\.php$/i.test(rel)) return { verdict: 'malicious', reason: 'nome no padrão do malware (8 caracteres hexadecimais)' };
  const owner = text.match(KNOWN_OWNERS)?.[0];
  if (owner) return { verdict: 'known', reason: `origem: ${owner}` };
  return { verdict: 'unknown', reason: 'origem não reconhecida' };
}
