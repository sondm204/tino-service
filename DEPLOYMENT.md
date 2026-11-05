# Ubuntu VPS deployment

This setup runs the API in Docker, keeps Supabase hosted, and uses Nginx on
the host for HTTPS. Object storage and the Telegram bot remain separate services.
The existing docker-compose.yml is for local MinIO only; do not use it as the
production API stack.

## 1. Install Docker and host tools

Install Docker Engine and the Compose plugin from the official Ubuntu guide:
https://docs.docker.com/engine/install/ubuntu/

Verify and install the reverse proxy:

```bash
sudo docker --version
sudo docker compose version
sudo apt update
sudo apt install -y git nginx certbot python3-certbot-nginx
```

Allow your actual SSH port before enabling a firewall. With default SSH:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Also allow TCP 80/443 in the VPS provider firewall. Do not expose API port 4000,
MinIO ports 9000/9001, or the bot's internal port to the public internet.
Docker-published ports can bypass UFW; the production API is explicitly bound
to 127.0.0.1 for this reason.

## 2. Clone the repository

Replace YOUR_REPOSITORY_URL with the service repository URL:

```bash
sudo mkdir -p /opt/tino-service
sudo chown "$USER":"$(id -gn)" /opt/tino-service
git clone YOUR_REPOSITORY_URL /opt/tino-service
cd /opt/tino-service
cp .env.example .env.production
chmod 600 .env.production
nano .env.production
```

Set real values, not the example credentials:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
AUTH_TOKEN_SECRET=YOUR_LONG_RANDOM_SECRET
TELEGRAM_BOT_SERVICE_SECRET=YOUR_SHARED_BOT_SECRET
TINO_TELEBOT_BASE_URL=https://YOUR_BOT_HOST
S3_REGION=YOUR_REGION
S3_BUCKET=YOUR_BUCKET
S3_ACCESS_KEY_ID=YOUR_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
S3_FORCE_PATH_STYLE=false
S3_PUBLIC_BASE_URL=https://YOUR_PUBLIC_STORAGE_HOST
```

Generate a secret with `openssl rand -hex 32`. Keep an existing AUTH_TOKEN_SECRET
when moving an existing deployment to avoid invalidating its access tokens.
The bot's TINO_BOT_SERVICE_SECRET must equal TELEGRAM_BOT_SERVICE_SECRET.

Additional configuration:

- Keep the same Supabase project to retain existing users, wallets and expenses.
  No local Postgres container is needed. Never expose the service role key to clients.
- AWS S3: remove S3_ENDPOINT. For S3-compatible storage, use its real reachable
  endpoint and appropriate S3_FORCE_PATH_STYLE value.
- S3_PUBLIC_BASE_URL must be publicly reachable over HTTPS by web/mobile clients.
  Migrating storage requires copying objects and considering existing stored URLs.
- Receipt OCR still requires AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and
  AZURE_DOCUMENT_INTELLIGENCE_KEY, even when hosting the API outside Azure.
- Email requires RESEND_API_KEY and a valid EMAIL_FROM.
- Push notifications can use FIREBASE_SERVICE_ACCOUNT_JSON. If using
  GOOGLE_APPLICATION_CREDENTIALS instead, mount the JSON file read-only into the
  container and set the variable to that container path. A host file path alone
  does not make the file available inside Docker.
- Compose overrides PORT to 8080 inside the container and publishes it as 4000
  on the host loopback interface.

### Telegram connectivity

`localhost` inside the API container refers to the API container, not the VPS
host or a separate bot container.

- Bot on another server: use its reachable HTTPS URL.
- Bot running directly on this VPS: use
  `TINO_TELEBOT_BASE_URL=http://host.docker.internal:4040`.
  The Compose file includes the Linux host-gateway mapping. The bot must listen
  on an interface reachable from Docker, not only 127.0.0.1. Restrict access to
  the bot port to trusted sources/Docker traffic.
- Bot in Docker: attach both containers to a common Docker network and use its
  service name, for example `http://telebot:4040`. Separate Compose projects do
  not share a network automatically.
- Set the bot's TINO_API_BASE_URL to this API's reachable URL as well.
- Avoid running two polling instances of the same Telegram bot during migration.

## 3. Build and start

```bash
sudo docker compose -f docker-compose.prod.yml config --quiet
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs --tail=100 api
curl --fail http://127.0.0.1:4000/health
```

The host does not need Node.js or pnpm; the Docker build installs dependencies
and compiles TypeScript. Healthcheck tests HTTP availability, not Supabase,
storage, OCR or Telegram connectivity. An unhealthy status alone does not trigger
a Docker restart; restart policy applies when the container exits.

## 4. Configure domain and HTTPS

Point an A record for api.example.com to the VPS public IPv4 address. Configure
AAAA only if IPv6 routing is also working. Replace the domain below.

Create `/etc/nginx/sites-available/tino-service`:

```nginx
server {
    listen 80;
    server_name api.example.com;

    # Individual expense images can be 10 MB; allow multipart overhead.
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 180s;
    }
}
```

Enable the site and issue the certificate:

```bash
sudo ln -s /etc/nginx/sites-available/tino-service /etc/nginx/sites-enabled/tino-service
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.example.com
sudo certbot renew --dry-run
curl --fail https://api.example.com/health
```

Update the web/mobile API base URLs and the bot's TINO_API_BASE_URL. Rebuild
clients if their API URL is embedded at build time. Verify login, a wallet query,
image upload, OCR, and Telegram group notifications before retiring the old API.

## 5. Updates, migrations and backup

For automated updates, use the GitHub Actions setup below. The following manual
commands apply to a deployment still managed from the original checkout.

```bash
cd /opt/tino-service
git pull --ff-only
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml logs --tail=100 api
```

After changing .env.production, run `up -d --force-recreate` with the same compose
file; `restart` does not reload container environment variables.

Database migrations are not automatically applied by this image. Apply reviewed
Supabase migrations from a trusted development machine or CI with the Supabase
CLI (`npx supabase login`, `npx supabase link --project-ref YOUR_PROJECT_REF`,
`npx supabase db push`). Back up production data first and verify the target
project before pushing. Keep schema changes compatible while switching versions.

Back up Supabase data, object storage and the production environment file securely.
Keep the previous release/image for rollback. Rebuilding this single-container
stack may briefly interrupt requests; it is not a zero-downtime deployment.

Before wider public exposure, review application-level rate limiting on auth and
OCR routes and restrict CORS to the actual web origins. HTTPS and Docker alone
do not provide abuse protection.

## 6. GitHub Actions CI/CD

`.github/workflows/ci-cd.yml` builds the production Docker image for pull requests
to `main`, pushes to `main`, and manual runs. The Dockerfile installs dependencies
with the frozen pnpm lockfile and compiles TypeScript. There is currently no test
script in package.json. Deployment runs only on `main`, after the build succeeds.

Create a GitHub environment named `production` under **Settings > Environments**.
The build job runs on GitHub's `ubuntu-latest` runner. The deploy job runs directly
on the VPS using its registered self-hosted runner with labels `self-hosted`,
`linux`, and `x64`. Ensure the matching runner is online and belongs to the target
VPS. If multiple runners have these labels, add a unique VPS label to `runs-on`
so deployment is routed to the correct host.

No SSH secrets or SSH port variable are required. The workflow does not use SSH
or SCP. Keep application configuration in `/opt/tino-service/.env.production`,
outside the runner checkout directory.

Prepare the VPS using sections 1–4 above. The runner service user must own
`/opt/tino-service`, be able to read `/opt/tino-service/.env.production`, and run
Docker without interactive sudo. Docker access effectively grants root privileges;
use a dedicated account. Ensure `curl` is installed and Compose supports `--wait`.
Create the external network once if it does not already exist:

```bash
sudo docker network inspect tino-internal >/dev/null 2>&1 || sudo docker network create tino-internal
```

Every deployment extracts the exact checked-out commit locally into a fresh
`/opt/tino-service/releases/<commit>-<run>-<attempt>` directory. The VPS rebuilds
the image, then updates the existing `tino-service` Compose project and waits for
its healthcheck. Both runner and VPS need access to the image/package registries;
the image is rebuilt on the VPS, not transferred from CI. The production env file
stays on the VPS and is symlinked into each release. No database migration runs.

After success, `/opt/tino-service/current` points to the release. Use it for
subsequent operational commands, always keeping the project name:

```bash
cd /opt/tino-service/current
docker compose -p tino-service -f docker-compose.prod.yml ps
docker compose -p tino-service -f docker-compose.prod.yml logs --tail=100 api
```

A failed healthcheck fails the workflow; it does not automatically roll back the
container. To roll back, enter a previous release directory and run
`docker compose -p tino-service -f docker-compose.prod.yml up -d --build --wait`.
Keep release directories needed for rollback and periodically remove older ones
to manage disk usage. Rebuilding an old release may resolve newer base images or
package downloads, so it is not an immutable-image rollback.

Push the workflow to `main` after configuring the environment, or use **Actions >
CI/CD > Run workflow** on `main`. A successful build alone does not establish
that the VPS runner permissions or production configuration are correct.
