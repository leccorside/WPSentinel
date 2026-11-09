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

// Posição (linha do alerts.jsonl) da última limpeza que cobriu cada site. A limpeza grava em details.sites os sites
// que limpou; eventos antigos, sem essa lista, cobriam todos os sites. Um alerta é pendente se veio depois dela.
export function lastCleanupFinder(alerts) {
  let allSites = -1;
  const bySite = new Map();
  alerts.forEach((event, index) => {
    if (event.message !== 'cleanup_completed') return;
    const keys = event.details?.sites;
    if (Array.isArray(keys)) for (const key of keys) bySite.set(key, index);
    else allSites = index;
  });
  return (siteKey) => Math.max(allSites, bySite.get(siteKey) ?? -1);
}
