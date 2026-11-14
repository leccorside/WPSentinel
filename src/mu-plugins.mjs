// PHP em wp-content/mu-plugins: o WordPress carrega todos em toda requisição, sem ativação e sem aparecer na lista
// de plugins. Em 13/11/2026 o mauriciosarmento ficou em branco por causa de widget.area.1778142423.php (mesmo kit dos
// plugins gallery-/widget-17781NNNNN): imprimia "<!--EuQYiXmr-->" antes do <?php, quebrando os cabeçalhos, e
// escondia o código com XOR e nomes de função montados com chr().
// Usado pelo monitor (alerta crítico) e pela limpeza (remoção com backup). phpMalwareSignal também serve aos temas.

import { classifyPhp, malwareSignature } from './dropins.mjs';

export const MU_PLUGINS_DIR = 'wp-content/mu-plugins';
export const MU_PLUGIN_MAX_BYTES = 1024 * 1024;

// Nome com o timestamp do kit (17781NNNNN) ou um timestamp Unix solto no nome do arquivo.
const KIT_NAME = /(?:^|[._-])1[5-9]\d{8}(?:[._-][^/]*)?\.php\d*$/i;
// Decodificador XOR caractere a caractere (chr(ord($a[$i]) ^ ord($b[$j]))).
const XOR_DECODER = /chr\s*\(\s*ord\s*\([^)]*\)\s*\^\s*ord\s*\(/i;
// Nome de função montado com chr() e chamado pela variável: $s .= chr($n); ... return $s($c);
const CHR_BUILT_CALL = /\.=\s*chr\s*\(\s*\$\w+\s*\)[\s\S]{0,300}?return\s+\$\w+\s*\(\s*\$\w+\s*\)/i;
// Comentário aleatório impresso antes do <?php (marca do kit, ex.: <!--EuQYiXmr-->).
const LEADING_MARKER = /^﻿?\s*(<!--[A-Za-z0-9]{6,12}-->)\s*<\?php/;
// Regras clássicas de webshell/backdoor (as mesmas do monitor para arquivos novos ou alterados).
const PHP_RULES = [
  ['webshell conhecido', /\b(?:FilesMan|WSO(?:\s|_)*Shell|b374k|alfa[ _-]?shell|c99shell|r57shell)\b/i],
  ['execução de carga codificada', /eval\s*\(\s*(?:base64_decode|gzinflate|gzuncompress|str_rot13)\s*\(/i],
  ['comando do sistema vindo da requisição', /(?:shell_exec|passthru|proc_open|popen|system|exec)\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/i],
  ['assert controlado pela requisição', /assert\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/i],
];

// Motivo, se o PHP tiver um sinal forte de malware; senão null.
export function phpMalwareSignal(text) {
  const marker = text.match(LEADING_MARKER)?.[1];
  if (marker) return `comentário injetado antes do <?php: ${marker}`;
  if (XOR_DECODER.test(text) && CHR_BUILT_CALL.test(text)) return 'código ofuscado (XOR e funções montadas com chr())';
  const signature = malwareSignature(text);
  if (signature) return `assinatura de malware: ${signature.slice(0, 40)}`;
  for (const [reason, pattern] of PHP_RULES) if (pattern.test(text)) return reason;
  return null;
}

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
  const signal = phpMalwareSignal(text);
  if (signal) return { verdict: 'malicious', reason: signal };
  const { verdict, reason } = classifyPhp(rel, text);
  if (verdict === 'malicious') return { verdict, reason };
  return { verdict: 'clean', reason: null };
}
