// Sessões de login do WordPress (usermeta.session_tokens), usadas pelo monitor e pelo painel.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { unserialize } from 'php-serialize';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Linhas de usermeta (user_id, meta_value) → uma entrada por sessão. O verificador já é um hash do token;
// o id guardado é só um hash dele.
export function parseSessions(rows, loginById) {
  const sessions = [];
  for (const row of rows) {
    let tokens;
    try { tokens = unserialize(String(row.meta_value || '')); } catch { tokens = null; }
    if (!tokens || typeof tokens !== 'object') continue;
    for (const [verifier, token] of Object.entries(tokens)) {
      const userId = String(row.user_id);
      sessions.push({
        id: sha256(`${userId}:${verifier}`).slice(0, 32),
        userId,
        login: loginById.get(userId) || null,
        ip: String(token?.ip || ''),
        ua: String(token?.ua || ''),
        loginAt: token?.login ? new Date(Number(token.login) * 1000).toISOString() : null,
        expiresAt: token?.expiration ? new Date(Number(token.expiration) * 1000).toISOString() : null,
      });
    }
  }
  return sessions;
}

// Sessões abertas pelo próprio servidor ou por "navegador" WordPress foram a assinatura do malware em 05/10/2026.
// Lista vazia = sessão sem sinal suspeito.
export function suspiciousReasons(session, serverIps) {
  const reasons = [];
  if (serverIps.has(session.ip)) reasons.push('IP do próprio servidor');
  if (!session.ua || /^WordPress\//i.test(session.ua)) reasons.push('navegador WordPress ou vazio');
  return reasons;
}

// IPs do servidor do site: DNS do domínio, do SFTP e do banco, mais os IPs extras (SERVER_IPS).
export async function lookupServerIps(site, extraIps = '') {
  const ips = new Set(String(extraIps).split(',').map((ip) => ip.trim()).filter(Boolean));
  for (const host of [new URL(site.url).hostname, site.sftp.host, site.db.host]) {
    if (!host) continue;
    if (net.isIP(host)) { ips.add(host); continue; }
    try {
      for (const { address } of await dns.lookup(host, { all: true })) ips.add(address);
    } catch {
      // Sem DNS, vale o que estiver em SERVER_IPS e nos hosts informados como IP.
    }
  }
  return ips;
}
