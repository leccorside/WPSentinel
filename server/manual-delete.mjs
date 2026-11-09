// Exclusão manual, pelo painel, de um arquivo ou pasta apontado por um item de revisão manual do plano.
// Mesmas garantias da limpeza automática: caminho relativo e seguro, backup completo conferido antes de apagar,
// registro no relatório diário e no alerts.jsonl.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { connectSftpWithRetry } from '../src/config.mjs';
import { appendSection, bullet, dateBR, timeBR } from '../src/report.mjs';

// Pastas só dentro de plugins/themes (ex.: um plugin legítimo usado pelo invasor); arquivos em qualquer lugar
// abaixo da raiz do WordPress, exceto o wp-config.php, que derrubaria o site.
const REMOVABLE_DIRECTORY = /^wp-content\/(?:plugins|themes)\/[^/]+$/;
const PROTECTED_FILES = new Set(['wp-config.php', 'index.php', 'wp-load.php', 'wp-settings.php', 'wp-blog-header.php']);

export function isDeletablePath(rel) {
  return typeof rel === 'string' && rel.length > 0 && !rel.startsWith('/') && !rel.includes('..')
    && !rel.includes('\\') && !PROTECTED_FILES.has(rel);
}

// Código que o operador digita para confirmar (mesma ideia do LIMPAR-<ID> da limpeza).
export const confirmationFor = (key) => `EXCLUIR-${String(key).slice(0, 6).toUpperCase()}`;

export async function deleteReviewedPath({ site, rel, dataDir, reportsDir, reason }) {
  if (!isDeletablePath(rel)) throw Object.assign(new Error(`Caminho recusado: ${rel}`), { status: 400 });
  const id = crypto.createHash('sha256').update(`${site.key}:${rel}:${Date.now()}`).digest('hex').slice(0, 10).toUpperCase();
  const remote = `${site.remoteRoot}/${rel}`.replace(/\/+/g, '/');
  const local = path.join(dataDir, 'backups', `${id}-${site.key}-arquivos`, ...rel.split('/'));
  const client = new SftpClient(`manual-delete-${id}`);
  let result;
  try {
    await connectSftpWithRetry(client, site.sftp, { readyTimeout: 20000, maxAttempts: 2 });
    const type = await client.exists(remote);
    if (!type) throw Object.assign(new Error(`Não existe mais no servidor: ${rel}`), { status: 404 });
    if (type === 'd') {
      if (!REMOVABLE_DIRECTORY.test(rel)) throw Object.assign(new Error(`Só pastas de wp-content/plugins ou themes podem ser apagadas pelo painel: ${rel}`), { status: 400 });
      const remoteFiles = await countRemoteFiles(client, remote);
      await fs.mkdir(local, { recursive: true });
      await client.downloadDir(remote, local);
      const localFiles = (await fs.readdir(local, { withFileTypes: true, recursive: true })).filter((e) => e.isFile()).length;
      if (localFiles !== remoteFiles) throw new Error(`Backup incompleto (${localFiles} de ${remoteFiles} arquivos); nada foi apagado`);
      await client.rmdir(remote, true);
      result = { kind: 'pasta', files: remoteFiles };
    } else if (type === '-') {
      await fs.mkdir(path.dirname(local), { recursive: true });
      const body = await client.get(remote);
      await fs.writeFile(local, Buffer.isBuffer(body) ? body : Buffer.from(body));
      await client.delete(remote, false);
      result = { kind: 'arquivo', files: 1 };
    } else {
      throw Object.assign(new Error(`Tipo não suportado (${type}): ${rel}`), { status: 400 });
    }
  } finally {
    await client.end().catch(() => {});
  }

  const backup = path.relative(path.dirname(dataDir), path.join(dataDir, 'backups', `${id}-${site.key}-arquivos`)).replace(/\\/g, '/');
  const event = {
    timestamp: new Date().toISOString(), severity: 'info', site: site.key, message: 'manual_delete',
    details: { path: rel, tipo: result.kind, arquivos: result.files, backup, motivo: reason },
  };
  await fs.appendFile(path.join(dataDir, 'alerts.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  try {
    const now = new Date();
    await appendSection(reportsDir, {
      title: `EXCLUSÃO MANUAL PELO PAINEL — ${dateBR(now)}, ${timeBR(now)} (horário de Brasília)`,
      summary: [`Site: ${site.name} (${new URL(site.url).hostname})`, '', `RESULTADO: ${result.kind.toUpperCase()} REMOVIDO(A) — ${rel}`],
      lines: [
        ...bullet(`Item de revisão manual: ${reason || '-'}`),
        ...bullet(`${result.files} arquivo(s) removido(s); backup em ${backup}/.`),
      ],
    }, now);
  } catch (error) {
    console.warn(`Relatório da exclusão manual não gravado: ${error.message}`);
  }
  return { ...result, path: rel, backup, id };
}

async function countRemoteFiles(client, dir) {
  let total = 0;
  for (const entry of await client.list(dir)) {
    if (entry.type === 'd') total += await countRemoteFiles(client, `${dir}/${entry.name}`);
    else if (entry.type === '-') total += 1;
  }
  return total;
}
