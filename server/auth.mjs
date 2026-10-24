// Autenticação do painel (Passo 4): sessão por cookie HttpOnly, proteção contra força bruta e comparação constante de senha.
import crypto from 'node:crypto';
import express from 'express';

const COOKIE_NAME = 'sentinel_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutos

export function createAuthManager(settings) {
  const activeSessions = new Map(); // token -> { createdAt, expiresAt }
  const failedAttempts = new Map(); // ip -> { count, lockedUntil }

  function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return String(forwarded).split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '127.0.0.1';
  }

  function parseCookies(req) {
    const header = req.headers.cookie;
    if (!header) return {};
    const cookies = {};
    for (const pair of header.split(';')) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        cookies[key] = decodeURIComponent(val);
      }
    }
    return cookies;
  }

  function isPasswordRequired() {
    return Boolean(settings.password && String(settings.password).trim().length > 0);
  }

  function verifyPassword(input) {
    if (!isPasswordRequired()) return true;
    if (typeof input !== 'string') return false;
    const expected = String(settings.password);
    const hashA = crypto.createHash('sha256').update(input).digest();
    const hashB = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  }

  function checkLockout(ip) {
    const record = failedAttempts.get(ip);
    if (!record) return { locked: false };
    if (record.lockedUntil && Date.now() < record.lockedUntil) {
      const waitMin = Math.ceil((record.lockedUntil - Date.now()) / 60000);
      return { locked: true, waitMinutes: waitMin };
    }
    if (record.lockedUntil && Date.now() >= record.lockedUntil) {
      failedAttempts.delete(ip);
    }
    return { locked: false };
  }

  function recordFailedAttempt(ip) {
    const now = Date.now();
    const record = failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_MS;
    }
    failedAttempts.set(ip, record);
    return record;
  }

  function clearFailedAttempts(ip) {
    failedAttempts.delete(ip);
  }

  function createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    activeSessions.set(token, { createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return token;
  }

  function isValidSession(token) {
    if (!token) return false;
    const session = activeSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      activeSessions.delete(token);
      return false;
    }
    return true;
  }

  function destroySession(token) {
    if (token) activeSessions.delete(token);
  }

  function authMiddleware(req, res, next) {
    if (!isPasswordRequired()) {
      req.authenticated = true;
      return next();
    }

    // Rotas públicas: healthcheck e rotas de login/status de auth
    if (
      req.path === '/api/health' ||
      req.path === '/api/auth/login' ||
      req.path === '/api/auth/status'
    ) {
      return next();
    }

    // Arquivos estáticos do front-end não são bloqueados para que a tela de login carregue
    if (!req.path.startsWith('/api')) {
      return next();
    }

    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    if (isValidSession(token)) {
      req.authenticated = true;
      return next();
    }

    return res.status(401).json({ error: 'Não autenticado' });
  }

  const router = express.Router();

  router.get('/status', (req, res) => {
    const required = isPasswordRequired();
    if (!required) {
      return res.json({ required: false, authenticated: true });
    }
    const cookies = parseCookies(req);
    const authenticated = isValidSession(cookies[COOKIE_NAME]);
    res.json({ required: true, authenticated });
  });

  router.post('/login', (req, res) => {
    if (!isPasswordRequired()) {
      return res.json({ ok: true, message: 'Autenticação não configurada' });
    }

    const ip = getClientIp(req);
    const lockout = checkLockout(ip);
    if (lockout.locked) {
      return res.status(429).json({
        error: `Muitas tentativas incorretas. Tente novamente em ${lockout.waitMinutes} minuto(s).`,
      });
    }

    const { password } = req.body || {};
    if (!verifyPassword(password)) {
      const record = recordFailedAttempt(ip);
      const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - record.count);
      if (record.lockedUntil) {
        return res.status(429).json({
          error: 'Limite de tentativas excedido. Bloqueado por 15 minutos.',
        });
      }
      return res.status(401).json({
        error: 'Senha incorreta',
        remainingAttempts: remaining,
      });
    }

    clearFailedAttempts(ip);
    const token = createSession();
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieFlags = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      ...(isSecure ? ['Secure'] : []),
    ];
    res.setHeader('Set-Cookie', cookieFlags.join('; '));
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    const cookies = parseCookies(req);
    destroySession(cookies[COOKIE_NAME]);
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieFlags = [
      `${COOKIE_NAME}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=0',
      ...(isSecure ? ['Secure'] : []),
    ];
    res.setHeader('Set-Cookie', cookieFlags.join('; '));
    res.json({ ok: true });
  });

  return {
    authMiddleware,
    authRouter: router,
    isPasswordRequired,
    isValidSession,
  };
}
