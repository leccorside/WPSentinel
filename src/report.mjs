// Relatório diário em texto: reports/REPORT-DD.MM.AA.txt (data de Brasília).
// O arquivo do dia é criado com cabeçalho na primeira varredura ou limpeza; as seguintes acrescentam
// seções numeradas, no mesmo formato do relatório manual (reports/REPORT-23.10.26.txt).
import fs from 'node:fs/promises';
import path from 'node:path';

const TZ = 'America/Sao_Paulo';
const RULE = '-----------------------------------------------------';
const WIDTH = 76;

const parts = (date) => Object.fromEntries(
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((p) => [p.type, p.value]),
);
export const dateBR = (date = new Date()) => { const p = parts(date); return `${p.day}/${p.month}/${p.year}`; };
export const timeBR = (date = new Date()) => { const p = parts(date); return `${p.hour}:${p.minute}`; };
export const number = (value) => new Intl.NumberFormat('pt-BR').format(value);

export function reportFile(reportsDir, date = new Date()) {
  const p = parts(date);
  return path.join(reportsDir, `REPORT-${p.day}.${p.month}.${p.year.slice(2)}.txt`);
}

// Quebra um texto em linhas de até WIDTH caracteres, com recuo.
export function wrap(text, indent = '  ', firstIndent = indent) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = firstIndent;
  let hasWord = false; // o recuo (ex.: "  - ") não conta como palavra já escrita
  for (const word of words) {
    if (hasWord && line.length + 1 + word.length > WIDTH) { lines.push(line); line = indent + word; }
    else line += (hasWord ? ' ' : '') + word;
    hasWord = true;
  }
  if (hasWord) lines.push(line);
  return lines;
}

export const bullet = (text, level = 1) => wrap(text, '  '.repeat(level) + '  ', '  '.repeat(level) + '- ');

// Acrescenta uma seção ao relatório do dia. `title` sem número; `lines` já formatadas.
export async function appendSection(reportsDir, { title, summary = [], lines = [] }, date = new Date()) {
  await fs.mkdir(reportsDir, { recursive: true });
  const file = reportFile(reportsDir, date);
  let current = '';
  try { current = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let out = current;
  if (!current) {
    out = [
      'RELATÓRIO DE VARREDURA DE SEGURANÇA — SITES WORDPRESS',
      '=====================================================',
      '',
      `Data: ${dateBR(date)} (horário de Brasília)`,
      'Gerado automaticamente pelo monitor (varreduras e limpezas do dia, em ordem).',
      '',
    ].join('\n');
  }
  const numbers = [...out.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  const section = ['', '', RULE, `${next}. ${title}`, RULE, '', ...summary, ...(summary.length && lines.length ? [''] : []), ...lines, ''];
  await fs.writeFile(file, out.replace(/\s*$/, '\n') + section.join('\n'), 'utf8');
  return file;
}
