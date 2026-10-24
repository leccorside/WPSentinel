// Configuração do painel: caminhos do projeto e leitura do .env sem tocar em process.env (os processos filhos,
// monitor e limpeza, leem o .env por conta própria e não podem herdar valores antigos).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { dataPaths } from '../src/config.mjs';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = path.join(ROOT_DIR, '.env');
export const WEB_DIR = path.join(ROOT_DIR, 'web', 'dist');

// O .env é lido a cada uso: o painel vai editá-lo (Passo 5) e o monitor relê a cada execução.
export function readEnvFile() {
  try {
    return dotenv.parse(fs.readFileSync(ENV_FILE));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Variáveis do painel: as do ambiente (docker-compose) têm prioridade sobre as do .env.
export function panelSettings(envFile = readEnvFile() || {}) {
  const pick = (name) => process.env[name] || envFile[name] || '';
  const host = pick('PANEL_HOST') || '127.0.0.1';
  const port = Number(pick('PANEL_PORT') || 8787);
  return {
    host,
    port,
    // No container o servidor escuta em todas as interfaces; quem limita a exposição é a porta publicada.
    listen: process.env.PANEL_LISTEN || host,
    password: pick('PANEL_PASSWORD'),
    paths: dataPaths(ROOT_DIR, { DATA_DIR: pick('DATA_DIR'), REPORTS_DIR: pick('REPORTS_DIR') }),
  };
}

export function isLoopback(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host).trim().toLowerCase());
}
