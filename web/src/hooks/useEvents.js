import { useEffect, useState } from 'react';

// Hook para gerenciar conexão SSE com /api/events
export function useEvents({ enabled = true, onMonitor, onJob } = {}) {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let es;
    try {
      es = new EventSource('/api/events');

      es.onopen = () => {
        setConnected(true);
      };

      es.onerror = () => {
        setConnected(false);
      };

      es.addEventListener('init', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (Array.isArray(data.recentLogs)) {
            setLogs(data.recentLogs);
          }
          if (data.monitor && onMonitor) onMonitor(data.monitor);
          if (data.job && onJob) onJob(data.job);
        } catch {}
      });

      es.addEventListener('log', (e) => {
        try {
          const entry = JSON.parse(e.data);
          setLogs((prev) => [...prev.slice(-400), entry]);
        } catch {}
      });

      es.addEventListener('monitor', (e) => {
        try {
          const monitor = JSON.parse(e.data);
          if (onMonitor) onMonitor(monitor);
        } catch {}
      });

      es.addEventListener('job', (e) => {
        try {
          const job = JSON.parse(e.data);
          if (onJob) onJob(job);
        } catch {}
      });
    } catch {
      setConnected(false);
    }

    return () => {
      if (es) es.close();
    };
  }, [enabled]);

  return {
    logs,
    clearLogs: () => setLogs([]),
    connected,
  };
}
