import React, { useState } from 'react';
import { api } from '../../api/client';

export function SiteConfigModal({
  isOpen,
  onClose,
  site = null, // se null, modo "Adicionar"
  onSaved,
}) {
  const isEditing = Boolean(site && site.key);

  const [formData, setFormData] = useState({
    key: site?.key || '',
    name: site?.name || '',
    url: site?.url || 'https://',
    remoteRoot: site?.remoteRoot || '/public_html',
    sftp: {
      host: site?.sftp?.host || '',
      port: site?.sftp?.port || 22,
      username: site?.sftp?.username || '',
      password: '',
    },
    db: {
      enabled: site?.db?.enabled ?? true,
      host: site?.db?.host || '',
      port: site?.db?.port || 3306,
      database: site?.db?.database || '',
      user: site?.db?.user || '',
      password: '',
      prefix: site?.db?.prefix || 'wp_',
      ssl: Boolean(site?.db?.ssl),
    },
  });

  const [showSftpPass, setShowSftpPass] = useState(false);
  const [showDbPass, setShowDbPass] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await api.sites.testManage(formData);
      setTestResult(res);
    } catch (err) {
      setError(`Falha ao testar conexão: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.sites.saveManage(formData);
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-scrim/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-2xl bg-surface-container-low border border-outline-variant/40 rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.85)] flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between bg-surface-container-lowest/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary border border-primary/30 flex items-center justify-center shadow-[0_0_12px_rgba(77,142,255,0.2)]">
              <span className="material-symbols-outlined text-lg">
                {isEditing ? 'edit_note' : 'add_circle'}
              </span>
            </div>
            <div>
              <h2 className="font-headline font-bold text-base text-on-surface">
                {isEditing ? `Editar Site: ${site.name}` : 'Cadastrar Novo Site Monitorado'}
              </h2>
              <p className="font-sans text-xs text-on-surface-variant">
                Configuração remota de SFTP e banco MySQL para inspeção de segurança contínua.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Form Body com Scroll */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {error && (
            <div className="p-3.5 bg-error-container/20 border border-error/40 text-error rounded-xl text-xs font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* Seção 1: Dados Gerais */}
          <div className="flex flex-col gap-3">
            <span className="font-headline font-bold text-xs uppercase tracking-wider text-outline flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-primary">public</span>
              Identificação do Perímetro
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-outline mb-1">
                  Identificador / Slug (Key) *
                </label>
                <input
                  type="text"
                  required
                  disabled={isEditing}
                  value={formData.key}
                  onChange={(e) => setFormData({ ...formData, key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                  placeholder="ex: loja_virtual"
                  className={`w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary ${
                    isEditing ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                />
                <span className="text-[10px] text-outline-variant font-mono">
                  {isEditing ? 'A chave não pode ser alterada após a criação.' : 'Usado internamente no histórico.'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-mono text-outline mb-1">
                  Nome Amigável do Site *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="ex: Loja Virtual Oficial"
                  className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-sans text-on-surface outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-outline mb-1">
                  URL Pública do WordPress *
                </label>
                <input
                  type="url"
                  required
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://meusite.com.br"
                  className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-outline mb-1">
                  Raiz Remota no Servidor *
                </label>
                <input
                  type="text"
                  required
                  value={formData.remoteRoot}
                  onChange={(e) => setFormData({ ...formData, remoteRoot: e.target.value })}
                  placeholder="/home/usuario/public_html"
                  className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                />
                <span className="text-[10px] text-outline-variant font-mono">
                  Pasta onde fica o <code className="text-primary font-bold">wp-config.php</code>.
                </span>
              </div>
            </div>
          </div>

          {/* Seção 2: Conexão SFTP */}
          <div className="flex flex-col gap-3 p-4 bg-surface-container rounded-xl border border-outline-variant/20">
            <span className="font-headline font-bold text-xs uppercase tracking-wider text-outline flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-primary">dns</span>
              Acesso SFTP (Auditoria de Arquivos)
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-mono text-outline mb-1">Host / Servidor SFTP *</label>
                <input
                  type="text"
                  required
                  value={formData.sftp.host}
                  onChange={(e) => setFormData({ ...formData, sftp: { ...formData.sftp, host: e.target.value } })}
                  placeholder="ftp.meusite.com.br ou IP"
                  className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-outline mb-1">Porta SFTP</label>
                <input
                  type="number"
                  value={formData.sftp.port}
                  onChange={(e) => setFormData({ ...formData, sftp: { ...formData.sftp, port: Number(e.target.value) || 22 } })}
                  className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-outline mb-1">Usuário SFTP *</label>
                <input
                  type="text"
                  required
                  value={formData.sftp.username}
                  onChange={(e) => setFormData({ ...formData, sftp: { ...formData.sftp, username: e.target.value } })}
                  placeholder="usuario_ftp"
                  className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                />
              </div>

              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-mono text-outline">
                    Senha SFTP {isEditing && '(Deixe em branco para manter)'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSftpPass(!showSftpPass)}
                    className="text-[10px] font-mono text-primary hover:underline cursor-pointer"
                  >
                    {showSftpPass ? 'Ocultar' : 'Exibir'}
                  </button>
                </div>
                <input
                  type={showSftpPass ? 'text' : 'password'}
                  required={!isEditing}
                  value={formData.sftp.password}
                  onChange={(e) => setFormData({ ...formData, sftp: { ...formData.sftp, password: e.target.value } })}
                  placeholder={isEditing ? '•••••••••••• (Inalterada)' : 'Senha do SFTP'}
                  className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* Seção 3: Conexão MySQL */}
          <div className="flex flex-col gap-3 p-4 bg-surface-container rounded-xl border border-outline-variant/20">
            <div className="flex items-center justify-between">
              <span className="font-headline font-bold text-xs uppercase tracking-wider text-outline flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-secondary">database</span>
                Banco de Dados MySQL Remoto
              </span>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-on-surface">
                <input
                  type="checkbox"
                  checked={formData.db.enabled}
                  onChange={(e) => setFormData({ ...formData, db: { ...formData.db, enabled: e.target.checked } })}
                  className="rounded border-outline-variant/40 bg-surface-container-lowest text-secondary focus:ring-0"
                />
                <span>Habilitar Inspeção do Banco</span>
              </label>
            </div>

            {formData.db.enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-mono text-outline mb-1">Host MySQL *</label>
                  <input
                    type="text"
                    required={formData.db.enabled}
                    value={formData.db.host}
                    onChange={(e) => setFormData({ ...formData, db: { ...formData.db, host: e.target.value } })}
                    placeholder="162.241.203.122 ou host.com"
                    className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-outline mb-1">Porta MySQL</label>
                  <input
                    type="number"
                    value={formData.db.port}
                    onChange={(e) => setFormData({ ...formData, db: { ...formData.db, port: Number(e.target.value) || 3306 } })}
                    className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-outline mb-1">Nome do Banco *</label>
                  <input
                    type="text"
                    required={formData.db.enabled}
                    value={formData.db.database}
                    onChange={(e) => setFormData({ ...formData, db: { ...formData.db, database: e.target.value } })}
                    placeholder="banco_wp"
                    className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-outline mb-1">Usuário do Banco *</label>
                  <input
                    type="text"
                    required={formData.db.enabled}
                    value={formData.db.user}
                    onChange={(e) => setFormData({ ...formData, db: { ...formData.db, user: e.target.value } })}
                    placeholder="usuario_wp"
                    className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-outline mb-1">Prefixo Tabelas</label>
                  <input
                    type="text"
                    value={formData.db.prefix}
                    onChange={(e) => setFormData({ ...formData, db: { ...formData.db, prefix: e.target.value } })}
                    placeholder="wp_"
                    className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                  />
                </div>

                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-mono text-outline">
                      Senha do Banco {isEditing && '(Deixe em branco para manter)'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowDbPass(!showDbPass)}
                      className="text-[10px] font-mono text-primary hover:underline cursor-pointer"
                    >
                      {showDbPass ? 'Ocultar' : 'Exibir'}
                    </button>
                  </div>
                  <input
                    type={showDbPass ? 'text' : 'password'}
                    required={!isEditing && formData.db.enabled}
                    value={formData.db.password}
                    onChange={(e) => setFormData({ ...formData, db: { ...formData.db, password: e.target.value } })}
                    placeholder={isEditing ? '•••••••••••• (Inalterada)' : 'Senha do MySQL'}
                    className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                  />
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-on-surface">
                    <input
                      type="checkbox"
                      checked={formData.db.ssl}
                      onChange={(e) => setFormData({ ...formData, db: { ...formData.db, ssl: e.target.checked } })}
                      className="rounded border-outline-variant/40 bg-surface-container-lowest text-secondary focus:ring-0"
                    />
                    <span>Conexão SSL/TLS</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Resultado do Teste no Modal */}
          {testResult && (
            <div className={`p-4 rounded-xl border flex flex-col gap-2 ${testResult.healthy ? 'bg-secondary/10 border-secondary/40' : 'bg-error-container/20 border-error/40'}`}>
              <div className="flex items-center gap-2">
                <span className={`material-symbols-outlined text-base ${testResult.healthy ? 'text-secondary' : 'text-error'}`}>
                  {testResult.healthy ? 'check_circle' : 'warning'}
                </span>
                <span className="font-headline font-bold text-xs text-on-surface">
                  {testResult.healthy ? 'Conectividade Validada com Sucesso!' : 'Falha em um ou mais testes de conexão'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono mt-1">
                <div className={`p-2 rounded bg-surface-container-lowest border ${testResult.sftp?.ok ? 'border-secondary/40 text-secondary' : 'border-error/40 text-error'}`}>
                  <span>SFTP: {testResult.sftp?.ok ? `OK (${testResult.sftp.latencyMs}ms)` : `Erro: ${testResult.sftp?.error || 'falha'}`}</span>
                </div>
                <div className={`p-2 rounded bg-surface-container-lowest border ${!formData.db.enabled ? 'border-outline/30 text-outline' : testResult.mysql?.ok ? 'border-secondary/40 text-secondary' : 'border-error/40 text-error'}`}>
                  <span>MySQL: {!formData.db.enabled ? 'Desativado' : testResult.mysql?.ok ? `OK (${testResult.mysql.latencyMs}ms)` : `Erro: ${testResult.mysql?.error || 'falha'}`}</span>
                </div>
                <div className={`p-2 rounded bg-surface-container-lowest border ${testResult.http?.ok ? 'border-secondary/40 text-secondary' : 'border-error/40 text-error'}`}>
                  <span>HTTP: {testResult.http?.ok ? `OK (${testResult.http.status || 200})` : `Erro: ${testResult.http?.error || 'falha'}`}</span>
                </div>
              </div>
            </div>
          )}

          {/* Footer Controls */}
          <div className="pt-4 border-t border-outline-variant/20 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || saving || !formData.sftp.host}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-on-surface rounded-xl text-xs font-headline font-semibold transition-colors cursor-pointer"
            >
              <span className={`material-symbols-outlined text-sm text-secondary ${testing ? 'animate-spin' : ''}`}>
                sync
              </span>
              <span>{testing ? 'Testando Conexões...' : 'Testar Credenciais Agora'}</span>
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-transparent hover:bg-surface-container text-on-surface-variant hover:text-on-surface rounded-xl text-xs font-mono transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || testing}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary font-headline font-bold text-xs rounded-xl transition-all shadow-[0_0_12px_rgba(77,142,255,0.25)] cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">save</span>
                <span>{saving ? 'Gravando...' : 'Salvar Configuração'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
