// PHP em wp-content/mu-plugins: o WordPress carrega todos em toda requisição, sem ativação e sem aparecer na lista
// de plugins. Em 13/11/2026 o mauriciosarmento ficou em branco por causa de widget.area.1778142423.php (mesmo kit dos
// plugins gallery-/widget-17781NNNNN): imprimia "<!--EuQYiXmr-->" antes do <?php, quebrando os cabeçalhos, e
// escondia o código com XOR e nomes de função montados com chr().
// Usado pelo monitor (alerta crítico) e pela limpeza (remoção com backup).

import { classifyPhp } from './dropins.mjs';

export const MU_PLUGINS_DIR = 'wp-content/mu-plugins';
export const MU_PLUGIN_MAX_BYTES = 1024 * 1024;

// Nome com o timestamp do kit (17781NNNNN) ou um timestamp Unix solto no nome do arquivo.
const KIT_NAME = /(?:^|[._-])1[5-9]\d{8}(?:[._-][^/]*)?\.php\d*$/i;
// Decodificador XOR caractere a caractere (chr(ord($a[$i]) ^ ord($b[$j]))).
const XOR_DECODER = /chr\s*\(\s*ord\s*\([^)]*\)\s*\^\s*ord\s*\(/i;
// Nome de função montado com chr() e chamado pela variável: $s .= chr($n); ... return $s($c);
const CHR_BUILT_CALL = /\.=\s*chr\s*\(\s*\$\w+\s*\)[\s\S]{0,300}?return\s+\$\w+\s*\(\s*\$\w+\s*\)/i;

export function isMuPluginPhp(rel) {
  return /^wp-content\/mu-plugins\/[^/]+\.(?:php\d*|phtml|phar)$/i.test(rel);
}

// Retorna { verdict: 'malicious' | 'clean', reason }.
export function classifyMuPlugin(rel, text) {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (KIT_NAME.test(name)) return { verdict: 'malicious', reason: 'nome no padrão do malware (timestamp no nome)' };
  // Um mu-plugin nunca imprime nada fora do PHP: texto antes do primeiro <?php sai em toda página e quebra os
  // cabeçalhos (redirecionamentos, cookies de login).
  const open = text.indexOf('<?');
  const before = (open === -1 ? '' : text.slice(0, open)).replace(/^﻿/, '');
  if (before.trim()) return { verdict: 'malicious', reason: `saída antes do <?php: ${before.trim().slice(0, 40)}` };
  if (XOR_DECODER.test(text) && CHR_BUILT_CALL.test(text)) return { verdict: 'malicious', reason: 'código ofuscado (XOR e funções montadas com chr())' };
  const { verdict, reason } = classifyPhp(rel, text);
  if (verdict === 'malicious') return { verdict, reason };
  return { verdict: 'clean', reason: null };
}
