# WP Sentinel

**WP Sentinel** is an external, agentless security monitor for WordPress. It watches your sites from the
outside — over SFTP, MySQL and HTTP — so nothing needs to be installed on the server, and a compromised site
can't disable it.

It tracks file integrity against a trusted baseline and flags webshells, malicious drop-ins (`db.php`,
`advanced-cache.php`, `object-cache.php`) and malware markers. It also catches rogue admins, hijacked sessions,
Application Passwords, malicious cron hooks and hidden SEO spam links injected into page content.

When something is found, the guided cleanup builds a plan, separates high-confidence fixes from items that need
human review, backs up everything it changes and only runs after explicit confirmation. Every scan and cleanup
is recorded in a plain-text daily report.

Sites, credentials and paths live in a single `.env` file, so one installation can watch any number of
WordPress sites, even across different hosts.

---

## Visão geral (pt-BR)

Monitor externo e somente-leitura para sites WordPress. Os sites, caminhos, acessos SFTP e bancos ficam
todos no `.env` (nada de site fica no código), então ele serve para qualquer WordPress. Ele verifica:

- arquivos executáveis novos, alterados ou removidos por SFTP;
- qualquer arquivo novo, alterado ou removido em `wp-content/mu-plugins`, mesmo sem extensão;
- marcadores do malware na raiz, em `wp-content` e em `mu-plugins` (`sc_XXXXXX`, `scgXXXXXX`, `z`,
  `.sc_*`, `.kk_*`, `.gk_*`, `.gt_*`, `.grd_*`, `.sd_*`, `.bt_*`, `.swm_*`, `.rd_*`, até 64 bytes) geram
  alerta crítico por pasta. A regra fica em `src/malware-markers.mjs` e também é usada pela limpeza;
- PHP em `uploads`, arquivos PHP ocultos, nomes perigosos e assinaturas de webshell;
- drop-ins (`wp-content/db.php`, `advanced-cache.php`, `object-cache.php`) e PHP solto em `wp-content/cache/`
  (subpastas de plugins de cache ficam de fora). O conteúdo é classificado em `src/dropins.mjs`: malicioso
  (assinatura de malware ou código ofuscado) gera alerta crítico em todo ciclo; origem não reconhecida gera
  alerta alto quando o arquivo aparece ou muda; drop-in de plugin conhecido (W3 Total Cache, WP Super Cache,
  LiteSpeed, Redis Object Cache, Query Monitor etc.) não gera alerta;
- sessões de login (`session_tokens`): toda sessão nova gera alerta alto; sessões abertas a partir
  do IP do próprio servidor ou com navegador `WordPress/...` (ou vazio) geram alerta crítico. Os IPs
  do servidor vêm do domínio de cada site, do `SFTP_HOST`, do `DB_HOST` e da variável opcional `SERVER_IPS`;
- SEO spam: links para outros domínios dentro de blocos com `position: fixed/absolute` e coordenada
  negativa de 100px ou mais (fora da tela). É verificado no HTML da home, pedida como navegador e como
  Googlebot, e no banco, no `_elementor_data` e no `post_content` de páginas, posts e modelos (alerta
  crítico, com página, widgets e domínios). A regra fica em `src/hidden-links.mjs`;
- disponibilidade HTTP, redirecionamento para outro domínio e cabeçalhos de segurança;
- bloqueio de `xmlrpc.php` e de PHP em `uploads`;
- usuários e mudanças de permissões, Application Passwords, sessões, novos posts,
  plugins ativos, domínios configurados e WP-Cron, quando o banco aceitar conexão remota.

O monitor nunca altera os sites ou o banco. Alertas são gravados em `.monitor-data/alerts.jsonl`.

Arquivos `wp-content/uploads/sucuri/sucuri-*.php` são dados internos voláteis do
Sucuri e não entram na comparação de hashes. Qualquer outro PHP em `uploads`
continua sendo tratado como crítico, e a execução web nessa pasta é testada em
todo ciclo.

## Configuração

1. Instale Node.js 20 ou superior.
2. Copie `.env.example` para `.env`.
3. Em `SITES`, liste os prefixos dos sites (ex.: `SITES=LOJA,BLOG`). Para cada prefixo, crie o bloco
   `<PREFIXO>_NAME`, `<PREFIXO>_URL` e `<PREFIXO>_REMOTE_ROOT` (pasta do WordPress no servidor, onde fica o
   `wp-config.php`). O `.env.example` traz um bloco completo de exemplo.
4. Preencha o SFTP padrão (`SFTP_*`). Um site em outra hospedagem pode ter o seu próprio
   (`<PREFIXO>_SFTP_*`). Use uma conta somente-leitura se a hospedagem permitir.
5. O banco é opcional (`<PREFIXO>_DB_*`). Na HostGator/cPanel pode ser necessário liberar o IP em
   **MySQL remoto**. Se a senha tiver `$` ou `#`, coloque-a entre aspas simples.
6. Execute `run-scan.cmd` para uma verificação única e `run-monitor.cmd` para monitorar
   continuamente.

Para incluir um site, crie o bloco dele e acrescente o prefixo em `SITES`; para retirar, tire o prefixo
da lista. A primeira varredura de um site novo salva o estado atual como referência. Não mude
`<PREFIXO>_KEY` de um site que já tem histórico: é ela que liga o site aos dados em `.monitor-data`.

### Frequência e hash completo

- `INTERVAL_SECONDS` (padrão 300): espera entre o fim de um ciclo e o início do próximo no `run-monitor.cmd`.
- `FULL_HASH_EVERY` (padrão 24): de quantos em quantos ciclos o
  monitor baixa todos os arquivos monitorados e recalcula o SHA-256 de cada um, para pegar alterações que
  preservam tamanho e data. Nos demais ciclos ele só lista os diretórios e baixa os arquivos novos ou com
  tamanho/data diferentes. Com 300 s de intervalo, 24 equivale a um hash completo a cada 4 horas, mais ou menos.
- Os ciclos de hash completo (múltiplos de `FULL_HASH_EVERY`; o número do ciclo é contínuo e inclui as
  varreduras do `run-scan.cmd`) levam mais que o dobro do tempo, e o console fica minutos parado em
  "inventariando arquivos..." no site maior. Isso é esperado, não é travamento. O primeiro ciclo de um site
  novo também faz hash completo.
- `npm run scan:full` faz uma varredura única forçando o hash completo, fora do calendário de
  `FULL_HASH_EVERY`. O console mostra "(hash completo)" ao lado de "inventariando arquivos..." quando o ciclo
  baixa todos os arquivos.
- `MAX_DOWNLOAD_BYTES` (padrão 8 MiB): arquivos maiores não são baixados para hash nem inspeção.

## Limpeza assistida

Execute `run-cleanup.cmd` depois que o monitor gerar alertas. O programa:

1. monta e salva um plano em `.monitor-data/last-cleanup-plan.json`;
2. separa ações automáticas de itens que exigem revisão humana;
3. exige a frase única `LIMPAR-ID-DO-PLANO` antes de qualquer alteração;
4. executa alterações de banco dentro de transações.

Use `npm run plan` para apenas gerar e visualizar o plano, sem abrir uma
confirmação de limpeza.

Também remove drop-ins e PHP em `wp-content/cache/` classificados como maliciosos (os de origem não
reconhecida vão para revisão manual). Todo arquivo apagado pela limpeza tem cópia em
`.monitor-data/backups/<plano>-<site>-arquivos/`.

Também remove, no banco: opções do malware (`sc_*`, cópias com nome hexadecimal, `wpeditor_*`),
plugins maliciosos que ficaram na lista de ativos e o snippet "Site Optimizer Bridge" do Code Snippets,
sempre com backup em `.monitor-data/backups/`. Usuários só são excluídos se o site tiver usuários na
baseline confiável; sem isso, a exclusão vai para revisão manual. Um site pode ter datas de corte
(`<PREFIXO>_SPAM_SINCE_POST` e `<PREFIXO>_SPAM_SINCE_PAGE` no `.env`): posts e páginas criados a partir delas
são apagados como spam. Só defina depois de confirmar que não há conteúdo legítimo nesse período.

A limpeza automática é limitada a indicadores de alta confiança: arquivos
maliciosos novos que não existiam na baseline, usuários novos, Application
Passwords, cadastro público, `wpse_user_id`, hooks maliciosos conhecidos, domínios adulterados e
marcadores de malware na raiz, em `wp-content` e em `wp-content/mu-plugins` (mesma regra do
monitor, arquivos de até 64 bytes, sem código). Toda limpeza também encerra **todas** as sessões de login dos
dois sites (`session_tokens`), inclusive as legítimas: depois dela, todos os usuários precisam
entrar de novo. Arquivos que
já existiam na baseline, posts novos e novos hooks de cron nunca são apagados
automaticamente, pois podem ser mudanças legítimas.

### SEO spam (links externos ocultos)

Quando encontra links externos ocultos, a limpeza:

1. salva o conteúdo original (`_elementor_data`, `post_content`, cache do Elementor e as revisões
   afetadas) em `.monitor-data/backups/<plano>-<site>-*.json`;
2. remove só os blocos ocultos, editando o texto gravado pelo WordPress sem recodificar o resto
   da página; um widget que fica sem nenhum HTML (widget inteiro do atacante) é retirado;
3. apaga o `_elementor_element_cache` das páginas limpas (o Elementor o recria na próxima visita);
4. apaga as revisões que contêm links ocultos, para que não sejam restauradas por engano;
5. confere o HTML publicado de cada página limpa, como navegador e como Googlebot.

Se uma página não puder ser editada com segurança, ela vai para revisão manual e nada é gravado.

Depois de uma limpeza, execute `run-scan.cmd` para confirmar o estado.

Na primeira execução, o estado atual é salvo como referência. Mesmo assim, assinaturas perigosas e arquivos em locais proibidos são analisados e alertados. Use `npm run reset-baseline` somente depois de confirmar que o estado remoto é confiável; esse comando também substitui a baseline usada pela limpeza.

## Relatórios diários

Cada varredura e cada limpeza grava uma seção em `reports/REPORT-DD.MM.AA.txt` (data de Brasília). O
primeiro registro do dia cria o arquivo com cabeçalho; os seguintes acrescentam seções numeradas, no
mesmo formato de `reports/REPORT-23.10.26.txt`:

- `run-scan.cmd`: sempre grava (por site: arquivos, HTTP, banco e alertas);
- `run-monitor.cmd`: grava só os ciclos com alerta alto ou crítico (a cada 5 minutos, gravar todos
  os ciclos encheria o arquivo sem informação nova);
- `run-cleanup.cmd`: sempre grava, inclusive quando não há nada a fazer, quando a confirmação é
  cancelada ou quando a execução é interrompida por erro (ações por site, conferência das páginas,
  revisão manual e backups). `npm run plan` (só consulta) não grava.

Os relatórios citam usuários, IPs e caminhos do servidor; trate-os como documentos internos. A pasta
`reports/` está no `.gitignore` e não é versionada.

## Códigos de saída

- `0`: nenhuma anomalia alta ou crítica;
- `1`: alerta de severidade alta;
- `2`: alerta crítico ou falha geral da varredura.

O arquivo `.env` contém segredos e está ignorado pelo Git. Não o envie por e-mail, chat ou repositório.
