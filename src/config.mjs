// Configuração dos sites a partir do .env. Nenhum dado de site fica no código.
//
// SITES=MEUSITE,OUTRO              prefixos dos sites monitorados, separados por vírgula
// <P>_NAME=Meu Site                nome exibido nos alertas
// <P>_URL=https://meusite.com.br   endereço público do site
// <P>_REMOTE_ROOT=/home/.../site   pasta do WordPress no servidor (onde fica o wp-config.php)
// <P>_KEY=meusite                  opcional: identificador usado no histórico (padrão: prefixo em minúsculas)
// <P>_SFTP_HOST/_PORT/_USER/_PASSWORD   opcionais: SFTP próprio do site (padrão: SFTP_* global)
// <P>_DB_HOST/_PORT/_NAME/_USER/_PASSWORD/_PREFIX/_SSL   banco (opcional; sem _DB_HOST não é verificado)
// <P>_SPAM_SINCE_POST / <P>_SPAM_SINCE_PAGE   opcionais: datas (AAAA-MM-DD) a partir das quais posts/páginas
//                                              são spam e podem ser apagados pela limpeza

const env = (name) => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

export function loadSites() {
  const prefixes = (env('SITES') || '').split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (!prefixes.length) throw new Error('Defina SITES no .env (ex.: SITES=MEUSITE,OUTRO). Veja o .env.example.');
  // O prefixo vira parte do nome das variáveis: só letras, números e _ (nomes com - ou espaço são fáceis de errar).
  const invalid = prefixes.filter((p) => !/^[A-Z][A-Z0-9_]*$/.test(p));
  if (invalid.length) throw new Error(`SITES: use só letras, números e _ nos prefixos, começando por letra (inválido: ${invalid.join(', ')}).`);
  const keys = new Set();
  return prefixes.map((p) => {
    const missing = ['URL', 'REMOTE_ROOT'].filter((field) => !env(`${p}_${field}`));
    if (missing.length) throw new Error(`Site ${p}: faltam no .env ${missing.map((field) => `${p}_${field}`).join(', ')}.`);
    const url = env(`${p}_URL`).replace(/\/+$/, '');
    try { new URL(url); } catch { throw new Error(`Site ${p}: ${p}_URL inválida (${url}).`); }
    // Caminho absoluto e diferente da raiz do servidor: "/" ou um caminho relativo varreria o lugar errado.
    const remoteRoot = env(`${p}_REMOTE_ROOT`).trim().replace(/\/+$/, '');
    if (!remoteRoot.startsWith('/') || remoteRoot.includes('..')) {
      throw new Error(`Site ${p}: ${p}_REMOTE_ROOT deve ser um caminho absoluto, sem "..", e diferente de "/" (ex.: /home/usuario/public_html).`);
    }
    const key = (env(`${p}_KEY`) || p.toLowerCase()).trim();
    if (!/^[a-z0-9_-]+$/i.test(key) || keys.has(key)) throw new Error(`Site ${p}: ${p}_KEY inválida ou repetida (${key}).`);
    keys.add(key);
    const sftp = {
      host: env(`${p}_SFTP_HOST`) || env('SFTP_HOST'),
      port: Number(env(`${p}_SFTP_PORT`) || env('SFTP_PORT') || 22),
      username: env(`${p}_SFTP_USER`) || env('SFTP_USER'),
      password: env(`${p}_SFTP_PASSWORD`) || env('SFTP_PASSWORD'),
    };
    const sinceErrors = ['POST', 'PAGE'].filter((t) => env(`${p}_SPAM_SINCE_${t}`) && !/^\d{4}-\d{2}-\d{2}$/.test(env(`${p}_SPAM_SINCE_${t}`)));
    if (sinceErrors.length) throw new Error(`Site ${p}: use AAAA-MM-DD em ${sinceErrors.map((t) => `${p}_SPAM_SINCE_${t}`).join(', ')}.`);
    return {
      key,
      envPrefix: p,
      name: env(`${p}_NAME`) || new URL(url).hostname,
      url,
      remoteRoot,
      sftp,
      db: {
        enabled: Boolean(env(`${p}_DB_HOST`)),
        envPrefix: p,
        host: env(`${p}_DB_HOST`),
        port: Number(env(`${p}_DB_PORT`) || 3306),
        database: env(`${p}_DB_NAME`),
        user: env(`${p}_DB_USER`),
        password: env(`${p}_DB_PASSWORD`),
        prefix: env(`${p}_DB_PREFIX`) || 'wp_',
        ssl: env(`${p}_DB_SSL`) === 'true',
      },
      spamContentSince: env(`${p}_SPAM_SINCE_POST`) || env(`${p}_SPAM_SINCE_PAGE`)
        ? { post: env(`${p}_SPAM_SINCE_POST`) || '9999-12-31', page: env(`${p}_SPAM_SINCE_PAGE`) || '9999-12-31' }
        : null,
    };
  });
}

// Uma conexão SFTP por credencial: sites na mesma hospedagem compartilham a conexão.
export function sftpKey(site) {
  return `${site.sftp.username}@${site.sftp.host}:${site.sftp.port}`;
}

export function assertSftp(site) {
  const missing = ['host', 'username', 'password'].filter((f) => !site.sftp[f]);
  if (missing.length) throw new Error(`Site ${site.envPrefix}: SFTP incompleto (defina SFTP_* ou ${site.envPrefix}_SFTP_*).`);
}
