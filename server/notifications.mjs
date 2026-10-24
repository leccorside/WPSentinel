// Central de Notificações Interna (Passo 12).
// - Monitora alerts.jsonl em tempo real (todas as origens: monitor, varredura, limpeza, scripts .cmd)
// - Emite alertas e notificações no canal SSE (/api/events)
// - Gerencia estado de leitura em .monitor-data/panel-notifications.json
// - Registra avisos do sistema (trabalho concluído/erro, limpeza aguardando confirmação, monitor parado)

import fs from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const NOTIFICATIONS_FILE = 'panel-notifications.json';
const SYSTEM_NOTIFICATIONS_FILE = 'system-notifications.json';
const MAX_SYSTEM_NOTIFICATIONS = 100;
const MAX_RETURNED_NOTIFICATIONS = 50;

export function createNotificationManager({ dataDir, orchestrator }) {
  const panelNotifPath = path.join(dataDir, NOTIFICATIONS_FILE);
  const sysNotifPath = path.join(dataDir, SYSTEM_NOTIFICATIONS_FILE);
  const alertsFilePath = path.join(dataDir, 'alerts.jsonl');

  let systemNotifications = [];
  let fileOffset = 0;
  let lineCounter = 0;
  let watcherActive = false;
  let pollTimer = null;

  // Carrega notificações de sistema persistidas
  async function loadSystemNotifications() {
    try {
      const content = await fs.readFile(sysNotifPath, 'utf8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        systemNotifications = data;
      }
    } catch {
      systemNotifications = [];
    }
  }

  async function saveSystemNotifications() {
    try {
      await fs.writeFile(sysNotifPath, JSON.stringify(systemNotifications.slice(-MAX_SYSTEM_NOTIFICATIONS), null, 2), 'utf8');
    } catch (err) {
      console.error('Falha ao salvar notificações de sistema:', err.message);
    }
  }

  // Carrega estado de leitura
  async function loadReadState() {
    try {
      const content = await fs.readFile(panelNotifPath, 'utf8');
      const data = JSON.parse(content);
      return {
        readIds: Array.isArray(data.readIds) ? data.readIds : [],
        allReadBefore: data.allReadBefore || null,
        updatedAt: data.updatedAt || null,
      };
    } catch {
      return {
        readIds: [],
        allReadBefore: null,
        updatedAt: null,
      };
    }
  }

  async function saveReadState(state) {
    try {
      await fs.writeFile(panelNotifPath, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error('Falha ao salvar estado de notificações lidas:', err.message);
    }
  }

  // Registra e emite aviso do sistema
  async function addSystemNotification({ type, title, message, severity = 'info', site = 'sistema', details = {}, link = null }) {
    const notification = {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'system',
      subType: type,
      severity, // 'critical' | 'high' | 'info'
      site,
      title,
      message,
      timestamp: new Date().toISOString(),
      details,
      link,
    };

    systemNotifications.push(notification);
    if (systemNotifications.length > MAX_SYSTEM_NOTIFICATIONS) {
      systemNotifications.shift();
    }

    await saveSystemNotifications();

    if (orchestrator?.broadcast) {
      orchestrator.broadcast('notification', notification);
    }

    return notification;
  }

  // Converte alerta do alerts.jsonl em notificação para o painel
  function alertToNotification(alert) {
    let link = 'overview';
    if (/limpeza/i.test(alert.message)) {
      link = 'cleanup';
    }

    let summary = alert.message;
    if (alert.details?.file) {
      summary = `${alert.message}: ${alert.details.file}`;
    } else if (alert.details?.type) {
      summary = `${alert.message} (${alert.details.type})`;
    } else if (alert.details?.sessionCount) {
      summary = `${alert.message}: ${alert.details.sessionCount} sessão(ões)`;
    }

    return {
      id: `alert-${alert.id}`,
      type: 'alert',
      subType: alert.message,
      severity: alert.severity || 'info',
      site: alert.site || 'geral',
      title: alert.message,
      message: summary,
      timestamp: alert.timestamp || new Date().toISOString(),
      details: alert.details || {},
      link,
    };
  }

  // Sincroniza offset e contagem inicial de linhas do alerts.jsonl
  async function syncInitialAlerts() {
    if (!existsSync(alertsFilePath)) {
      fileOffset = 0;
      lineCounter = 0;
      return;
    }

    try {
      const stat = await fs.stat(alertsFilePath);
      fileOffset = stat.size;

      // Conta quantas linhas existem atualmente para manter ids sequenciais corretos
      let count = 0;
      const rl = readline.createInterface({
        input: createReadStream(alertsFilePath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (line.trim()) count += 1;
      }
      lineCounter = count;
    } catch {
      fileOffset = 0;
      lineCounter = 0;
    }
  }

  // Lê novas linhas adicionadas ao alerts.jsonl
  async function processNewAlerts() {
    if (!existsSync(alertsFilePath)) return;

    let stat;
    try {
      stat = await fs.stat(alertsFilePath);
    } catch {
      return;
    }

    // Se o arquivo diminuiu (truncado ou rotacionado), reinicia do zero
    if (stat.size < fileOffset) {
      fileOffset = 0;
      lineCounter = 0;
    }

    if (stat.size === fileOffset) {
      return; // Sem novos bytes
    }

    const currentOffset = fileOffset;
    const newBytesLength = stat.size - currentOffset;
    fileOffset = stat.size;

    let handle;
    try {
      handle = await fs.open(alertsFilePath, 'r');
      const buffer = Buffer.alloc(newBytesLength);
      await handle.read(buffer, 0, newBytesLength, currentOffset);
      await handle.close();

      const text = buffer.toString('utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);

      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          const alert = {
            ...raw,
            id: lineCounter++,
          };

          // Publica no canal SSE para ouvintes de alert
          if (orchestrator?.broadcast) {
            orchestrator.broadcast('alert', alert);
            const notif = alertToNotification(alert);
            orchestrator.broadcast('notification', notif);
          }
        } catch {
          // Linha incompleta ou corrompida ignorada
        }
      }
    } catch (err) {
      if (handle) await handle.close().catch(() => {});
      console.error('Erro ao ler novas linhas de alerts.jsonl:', err.message);
    }
  }

  // Inicia o watcher de alerts.jsonl
  async function startAlertsWatcher() {
    if (watcherActive) return;
    watcherActive = true;

    await loadSystemNotifications();
    await syncInitialAlerts();

    // Polling a cada 1.5s como garantia multiplataforma (Docker, WSL e Windows)
    pollTimer = setInterval(() => {
      processNewAlerts().catch(() => {});
    }, 1500);
    pollTimer.unref();
  }

  function stopAlertsWatcher() {
    watcherActive = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Obter lista consolidada de notificações com contagem de não lidas
  async function getNotifications() {
    const readState = await loadReadState();
    const readIdsSet = new Set(readState.readIds);
    const allReadBeforeTime = readState.allReadBefore ? new Date(readState.allReadBefore).getTime() : 0;

    // 1. Coleta alertas de alerts.jsonl
    const alertItems = [];
    if (existsSync(alertsFilePath)) {
      try {
        const content = await fs.readFile(alertsFilePath, 'utf8');
        const lines = content.split(/\r?\n/).filter(Boolean);
        lines.forEach((line, index) => {
          try {
            const parsed = JSON.parse(line);
            alertItems.push(alertToNotification({ ...parsed, id: index }));
          } catch {}
        });
      } catch {}
    }

    // 2. Mescla alertas e notificações de sistema
    const allItems = [...alertItems, ...systemNotifications];

    // 3. Ordena decrescente por data
    allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // 4. Marca status de leitura e calcula contadores
    let unreadCount = 0;
    let hasCriticalUnread = false;

    const enrichedItems = allItems.map((item) => {
      const itemTime = new Date(item.timestamp).getTime();
      const isRead = readIdsSet.has(item.id) || (allReadBeforeTime > 0 && itemTime <= allReadBeforeTime);

      if (!isRead) {
        unreadCount += 1;
        if (item.severity === 'critical') {
          hasCriticalUnread = true;
        }
      }

      return {
        ...item,
        read: Boolean(isRead),
      };
    });

    return {
      unreadCount,
      hasCriticalUnread,
      items: enrichedItems.slice(0, MAX_RETURNED_NOTIFICATIONS),
      readState: {
        allReadBefore: readState.allReadBefore,
        updatedAt: readState.updatedAt,
      },
    };
  }

  // Marcar uma ou todas como lidas
  async function markAsRead({ id, all }) {
    const state = await loadReadState();
    const readIdsSet = new Set(state.readIds);

    if (all) {
      state.allReadBefore = new Date().toISOString();
      state.readIds = []; // limpa array específico já que tudo antes de agora está lido
    } else if (id) {
      readIdsSet.add(String(id));
      state.readIds = Array.from(readIdsSet).slice(-500); // limita tamanho
    }

    state.updatedAt = new Date().toISOString();
    await saveReadState(state);

    const updated = await getNotifications();

    if (orchestrator?.broadcast) {
      orchestrator.broadcast('notifications_updated', {
        unreadCount: updated.unreadCount,
        hasCriticalUnread: updated.hasCriticalUnread,
      });
    }

    return {
      ok: true,
      unreadCount: updated.unreadCount,
      hasCriticalUnread: updated.hasCriticalUnread,
    };
  }

  return {
    startAlertsWatcher,
    stopAlertsWatcher,
    addSystemNotification,
    getNotifications,
    markAsRead,
  };
}
