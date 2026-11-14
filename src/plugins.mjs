// Plugins que a limpeza apaga (pasta inteira, com backup, e retirada da lista de ativos) e que a varredura acusa como
// crítico enquanto estiverem instalados. Usado pelo monitor e pela limpeza.
// - Kit do malware (vapor-curator-tap, pulse-beacon-ops, cloudflare-v2-23, ...) e os sufixos com timestamp 17781NNNNN.
// - code-snippets e fileorganizer: legítimos no repositório, mas usados pelo invasor (decisão do responsável em
//   09/11/2026, sem revisão manual).
// - wp-file-manager: legítimo, mas dá acesso total aos arquivos pelo painel e tem histórico de falha explorada em massa
//   (CVE-2020-25213); proibido nos sites por decisão do responsável em 13/11/2026.
export const MALICIOUS_PLUGIN = /^(vapor-curator-tap|pulse-beacon-ops|cloudflare-v2-23|script-4aec0f13-4aec0f13|wordpress-site-editor-e64d0d1c|wp-security-helper|smart-toolkit-plus|database-framework-edition|performance-fix-pro|smart-fix-edition|system-fix-plus|smart-cleaner-plus|smart-fix-pro|core-manager-plus|seo-patch-max|classic-cleaner-bundle|core-scanner-standard|wpueditors|fileorganizer|code-snippets|seo-framework-x|visual-scanner-edition|wp-file-manager)$|^(gallery|security|custom|widget)[_-]17781\d{5}$/;

// Slug do plugin de um caminho relativo (pasta wp-content/plugins/<slug>/... ou arquivo solto <slug>.php).
export function pluginSlugOf(rel) {
  const match = rel.match(/^wp-content\/plugins\/([^/]+)(\/|$)/);
  if (!match) return null;
  return match[2] === '/' ? match[1] : match[1].replace(/\.php$/i, '');
}
