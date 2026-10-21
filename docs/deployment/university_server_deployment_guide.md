# Step-by-Step University Server Deployment Guide (Option A)

> ⚠️ **DEPRECATED for the CAMT `dev2` server.** This guide assumes you own a VM
> with SSH access and run `docker compose up` yourself. The CAMT server
> (`dev2.camt.cmu.ac.th`) is a **shared Docker Swarm managed through Portainer** —
> no SSH, no host filesystem, deploy by pasting a stack into the web UI. Use
> **`docs/supabase-to-university-server-cutover.md`** + **`docker-stack.yml`**
> instead. This file is kept only for a self-owned-VM scenario.

This guide takes you through the step-by-step process of deploying the **ActiveCAMT** ecosystem onto a university-provided virtual machine (typically running Ubuntu Server). 

By using Docker Compose, the deployment behaves identically to a local setup, ensuring zero compatibility issues regardless of what OS or library versions the university server runs.

---

## 📋 Step 1: Install Docker & Docker Compose on the Server
If the server doesn't have Docker installed yet, connect to the server via SSH and execute the following commands to install it (Ubuntu/Debian example):

```bash
# Update local packages
sudo apt update && sudo apt upgrade -y

# Install Docker dependencies
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker’s official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up the stable repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine & Compose
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

---

## 📦 Step 2: Upload Project Files to the Server
Clone the repository directly onto the server using Git, or copy the codebase directory:

```bash
# Example if using Git
git clone <your-university-repo-url> activecamt
cd activecamt
```

---

## 🔑 Step 3: Configure Environment Variables
Create the production environment file by copying our template:

```bash
cp .env.production.example .env
nano .env
```

Inside `nano`, replace the placeholder values:
1. Choose a highly secure `POSTGRES_PASSWORD`.
2. Generate a secure `AUTH_SECRET` by running this command in another terminal tab:
   ```bash
   openssl rand -base64 33
   ```
3. Set `AUTH_URL` to your university's domain (e.g., `https://activecamt.university.ac.th/api/auth`).
4. Enter your Google OAuth `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Make sure to add `https://activecamt.university.ac.th/api/auth/callback/google` in the Authorized Redirect URIs inside the [Google Cloud Console](https://console.cloud.google.com).

Save and exit `nano` (`CTRL+O`, `Enter`, `CTRL+X`).

---

## 🚀 Step 4: Build & Launch Containers
Now, instruct Docker Compose to build the production Next.js image and spin up the web and database containers in the background:

```bash
# Build and run containers in detached mode (background)
sudo docker compose up -d --build
```
This command will:
1. Install Alpine Linux + Node.js 20 inside a builder layer.
2. Compile and package the Next.js production build (`npm run build`).
3. Launch a lightweight runner container running Next.js.
4. Launch a PostgreSQL 16 database.
5. Create a local persistent folder `./public/uploads` bound to the host so uploaded image assets never get deleted.

### Monitor Logs
Verify the containers are running properly:
```bash
sudo docker compose logs -f
```

---

## 🗄️ Step 5: Run Database Migrations on Production
Because our PostgreSQL database was created freshly by Docker, we must push the Drizzle schema and seed the initial categories and points:

```bash
# Run migrations using the command inside the running web container
sudo docker compose exec web npm run db:migrate

# Seed initial system data (if needed)
sudo docker compose exec web npm run db:seed
```

---

## 👑 Step 6: Promote Your Account to Admin
Since Google authentication will only allow standard student access initially, you must elevate your university Google account to admin status:

1. Visit the website and sign in once with your Google account.
2. Back in the server terminal, run the admin promotion script inside the container, specifying your Google email address:
   ```bash
   sudo docker compose exec web npx tsx --env-file=.env scripts/elevate-admin.ts your-email@university.ac.th
   ```
   *(This script connects straight to your Postgres database and updates your account role to `'admin'` instantly).*

---

## 🛡️ Step 7: Configure Nginx SSL (Let's Encrypt)
If the university has an external reverse proxy (a load balancer in front of the VM), they will handle the SSL certificates for you. If you need to handle SSL directly on the VM:

1. Install certbot:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   ```
2. Request a free SSL certificate for your university domain:
   ```bash
   sudo certbot --nginx -d activecamt.university.ac.th
   ```
   Certbot will automatically read your domain, verify it, generate SSL keys, and inject them directly into Nginx. It also sets up a system cron job to auto-renew the certificate every 90 days.

---

## 📈 Monitoring & Maintenance

### How to restart the application after a code change:
If you make a code change or update a file, push it to the server and rebuild the containers using:
```bash
git pull
sudo docker compose up -d --build
```
*(Your database records and dynamic uploaded images in `public/uploads` will remain entirely safe and unmodified during this update).*

### How to check database logs:
```bash
sudo docker compose logs db
```

### View container status:
```bash
sudo docker compose ps
```
