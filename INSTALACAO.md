# Manual de Instalação — Sistema CAMI'S EVENTOS em Servidor Próprio

**camiseventos.co.mz · Edição 1 · 2026**

Este manual explica, passo a passo, como instalar o Sistema de Vendas CAMI'S EVENTOS num servidor próprio e ligá-lo ao domínio **camiseventos.co.mz**. Foi escrito para ser seguido por um técnico de informática ou pela equipa de uma empresa de hospedagem.

---

# 1. O que é necessário

**Tabela 1 — Requisitos**

| Item | Recomendado | Mínimo |
|---|---|---|
| Servidor (VPS) | 2 CPU, 4 GB RAM, 40 GB disco | 1 CPU, 2 GB RAM, 20 GB |
| Sistema operativo | Ubuntu 22.04 ou 24.04 LTS | Debian 11+ |
| Software | Docker + Docker Compose | Node.js 20 + MySQL 8 |
| Domínio | camiseventos.co.mz registado | — |

Onde contratar o VPS (exemplos): **HostAfrica, DigitalOcean, Hetzner, Contabo** (a partir de ~5 USD/mês) ou uma empresa moçambicana de hospedagem com VPS.

# 2. Registar o domínio camiseventos.co.mz

1. Os domínios **.co.mz** são registados através de entidades credenciadas em Moçambique (por exemplo, empresas de hospedagem locais que façam registo junto do registo nacional .mz).
2. Após o registo, no painel de gestão do domínio, crie os **registos DNS**:

| Tipo | Nome | Valor |
|---|---|---|
| A | camiseventos.co.mz | IP do seu servidor |
| A | www.camiseventos.co.mz | IP do seu servidor |

A propagação do DNS pode demorar de alguns minutos a 24 horas.

# 3. Instalação — Opção A: Docker (recomendada)

## 3.1. Instalar o Docker no servidor

Ligue-se ao servidor por SSH e execute:

```bash
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin
```

## 3.2. Enviar o pacote para o servidor

No seu computador, envie a pasta `camis-eventos` (dentro deste ZIP) para o servidor:

```bash
scp -r camis-eventos root@IP-DO-SERVIDOR:/opt/
```

Ou use um programa como o **WinSCP** (Windows) para arrastar a pasta.

## 3.3. Configurar as senhas

No servidor:

```bash
cd /opt/camis-eventos
cp .env.example .env
nano .env
```

No ficheiro `.env`:

- em `DATABASE_URL`, substitua `TROQUE-ESTA-SENHA` por uma senha forte à sua escolha;
- em `APP_SECRET`, coloque uma chave longa e aleatória (pode gerar com `openssl rand -hex 32`).

Depois edite o `docker-compose.yml` e coloque **a mesma senha** em `MYSQL_PASSWORD` (e uma outra em `MYSQL_ROOT_PASSWORD`).

## 3.4. Construir e arrancar

```bash
docker compose up -d --build
```

Aguarde 2–5 minutos na primeira vez (está a descarregar e compilar tudo).

## 3.5. Criar as tabelas e os dados iniciais (só na 1.ª vez)

```bash
docker compose exec app npx drizzle-kit push
docker compose exec app npx tsx db/seed.ts
```

O primeiro comando cria todas as tabelas; o segundo carrega os **200+ produtos** do menu e cria os utilizadores iniciais:

| Utilizador | Perfil | PIN inicial |
|---|---|---|
| Administrador | Admin | 1234 |
| Gerente | Gestor | 2345 |
| Vendedor 1 | Vendedor | 3456 |

> **⚠️ Mude estes PINs imediatamente** no sistema, em Configurações → Utilizadores.

## 3.6. Verificar

Abra no navegador: `http://IP-DO-SERVIDOR:3000` — deve aparecer o ecrã de login do sistema.

# 4. Instalação — Opção B: sem Docker (Node.js + MySQL directos)

1. Instale o **Node.js 20** e o **MySQL 8** (ou MariaDB 10.6+).
2. Crie a base de dados:

```sql
CREATE DATABASE camis CHARACTER SET utf8mb4;
CREATE USER 'camis'@'localhost' IDENTIFIED BY 'SENHA-FORTE';
GRANT ALL PRIVILEGES ON camis.* TO 'camis'@'localhost';
```

3. Copie a pasta `camis-eventos` para o servidor, entre nela e execute:

```bash
cp .env.example .env     # edite o .env: DATABASE_URL=mysql://camis:SENHA-FORTE@localhost:3306/camis
npm ci                   # instala as dependências (pode demorar alguns minutos)
npm run build            # compila o sistema
npx drizzle-kit push     # cria as tabelas
npx tsx db/seed.ts       # carrega produtos e utilizadores iniciais
npm start                # arranca o sistema na porta 3000
```

4. Para manter o sistema sempre ligado, use **systemd**:

```ini
# /etc/systemd/system/camis.service
[Unit]
Description=CAMIS Eventos - Sistema de Vendas
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/camis-eventos
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

Depois: `sudo systemctl enable --now camis`.

# 5. Ligar o domínio com HTTPS (Nginx + certificado grátis)

1. Instale o Nginx e o Certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

2. Copie o ficheiro de exemplo incluído no pacote:

```bash
sudo cp nginx-camiseventos.conf /etc/nginx/sites-available/camiseventos
sudo ln -s /etc/nginx/sites-available/camiseventos /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

3. Active o certificado HTTPS (gratuito, renova sozinho):

```bash
sudo certbot --nginx -d camiseventos.co.mz -d www.camiseventos.co.mz
```

4. Pronto — o sistema fica disponível em **https://camiseventos.co.mz** e a loja dos clientes em **https://camiseventos.co.mz/?loja=1**.

# 6. Após a instalação (configuração inicial)

1. Entre com **Administrador / 1234** e mude as senhas de todos os utilizadores.
2. Em **Configurações**, confirme os dados da empresa (contactos, número Transferência eMola, código Levantamento eMola, conta FNB, WhatsApp do resumo diário).
3. Verifique os **horários de funcionamento** e os **bairros de entrega**.
4. Teste um pedido na loja online (`/?loja=1`) com pagamento em Dinheiro e confirme-o na área Pedidos Online.
5. Consulte o **Manual de Uso** (Edição 8) para o dia a dia da equipa.

# 7. Manutenção

**Cópias de segurança da base de dados (diário, automático):**

```bash
# adicione ao crontab (crontab -e):
0 2 * * * docker compose -f /opt/camis-eventos/docker-compose.yml exec -T db mysqldump -uroot -pSENHA-ROOT camis | gzip > /backups/camis-$(date +\%F).sql.gz
```

**Actualizar o sistema com uma versão nova:** substitua a pasta pelos ficheiros novos (mantendo o `.env`) e execute `docker compose up -d --build` (ou, sem Docker: `npm ci && npm run build && sudo systemctl restart camis`). Se a versão nova trouxer alterações de base de dados, execute `npx drizzle-kit push` antes de reiniciar.

**Ver os registos (logs):** `docker compose logs -f app` (ou `journalctl -u camis -f` sem Docker).

# 8. Resolução de problemas

| Sintoma | Solução |
|---|---|
| Página não abre | Verifique se o contentor está ligado: `docker compose ps`; veja os logs |
| «Erro de ligação ao servidor» no login | A base de dados não respondeu a tempo — reinicie: `docker compose restart` |
| Domínio não abre | Confirme os registos DNS (passo 2) e aguarde a propagação |
| HTTPS falha no certbot | O DNS tem de estar já a apontar para o servidor; repita o passo 5.3 |
| Fotos/comprovativos não carregam | Confirme `client_max_body_size 50m;` na configuração do Nginx |

---

*CAMI'S EVENTOS · Chimoio · 87 458 9150 / 86 059 8335 · Transformando Sonhos em Realidade*
