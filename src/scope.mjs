// Escopo por site: --site=<chave> no monitor e na limpeza, e a regra de alerta "pendente" por site.

export function siteArg(argv = process.argv) {
  return argv.find((arg) => arg.startsWith('--site='))?.slice('--site='.length).trim() || null;
}

// Sem chave: todos os sites. Com chave: só ele (chave desconhecida é erro, nunca "todos" por engano).
export function selectSites(allSites, key) {
  if (!key) return allSites;
  const selected = allSites.filter((site) => site.key === key);
  if (!selected.length) throw new Error(`Site desconhecido em --site: ${key} (cadastrados: ${allSites.map((s) => s.key).join(', ')}).`);
  return selected;
}

// Eventos que "zeram" os alertas de um site: a limpeza executada e a redefinição da baseline (o estado atual passa
// a ser o confiável, então o que foi alertado antes dela deixa de estar pendente).
export const RESOLVING_EVENTS = new Set(['cleanup_completed', 'baseline_reset']);

// Posição (linha do alerts.jsonl) do último evento que resolveu cada site. A limpeza e a redefinição gravam em
// details.sites os sites cobertos; eventos antigos, sem essa lista, cobriam todos. Pendente = alerta depois dele.
export function lastCleanupFinder(alerts) {
  let allSites = -1;
  const bySite = new Map();
  alerts.forEach((event, index) => {
    if (!RESOLVING_EVENTS.has(event.message)) return;
    const keys = event.details?.sites;
    if (Array.isArray(keys)) for (const key of keys) bySite.set(key, index);
    else allSites = index;
  });
  return (siteKey) => Math.max(allSites, bySite.get(siteKey) ?? -1);
}
