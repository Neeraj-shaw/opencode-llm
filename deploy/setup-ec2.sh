#!/bin/bash
#
# freeflow-omniroute EC2 setup script
# Run as root or with sudo on Ubuntu/Amazon Linux 2023
#
set -euo pipefail

echo "╔════════════════════════════════════════════════════════╗"
echo "║  freeflow-omniroute — EC2 Setup                       ║"
echo "║  33 free AI models for OmniRoute                      ║"
echo "╚════════════════════════════════════════════════════════╝"

# ── 1. Install Node.js 22 ──────────────────────────────────────
echo ""
echo "→ Checking Node.js..."
if ! command -v node &> /dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  echo "  Installing Node.js 22..."
  if command -v apt-get &> /dev/null; then
    # Ubuntu/Debian
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif command -v yum &> /dev/null; then
    # Amazon Linux / RHEL
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    yum install -y nodejs
  else
    echo "  ✗ Unsupported OS. Install Node.js 22+ manually."
    exit 1
  fi
else
  echo "  ✓ Node.js $(node -v) already installed"
fi

# ── 2. Create app directory ────────────────────────────────────
APP_DIR="/opt/freeflow-omniroute"
echo ""
echo "→ Setting up ${APP_DIR}..."
mkdir -p "${APP_DIR}/data"

# Copy files if running from the repo
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -f "${REPO_DIR}/package.json" ]]; then
  echo "  Copying from ${REPO_DIR}..."
  cp -r "${REPO_DIR}/package.json" "${APP_DIR}/"
  cp -r "${REPO_DIR}/tsconfig.json" "${APP_DIR}/"
  cp -r "${REPO_DIR}/src" "${APP_DIR}/"
else
  echo "  ✗ Could not find source files. Clone the repo first:"
  echo "    git clone <repo-url> && cd freeflow-omniroute && sudo ./deploy/setup-ec2.sh"
  exit 1
fi

# ── 3. Install dependencies ───────────────────────────────────
echo ""
echo "→ Installing dependencies..."
cd "${APP_DIR}"
npm install --production

# ── 4. Create system user ─────────────────────────────────────
echo ""
echo "→ Setting up user..."
if ! id -u freeflow &> /dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin freeflow
fi
chown -R freeflow:freeflow "${APP_DIR}"

# ── 5. Install systemd service ────────────────────────────────
echo ""
echo "→ Installing systemd service..."
cat > /etc/systemd/system/freeflow-omniroute.service << 'EOF'
[Unit]
Description=Freeflow OmniRoute - Free LLM API Gateway
After=network.target
Wants=network.target

[Service]
Type=simple
User=freeflow
Group=freeflow
WorkingDirectory=/opt/freeflow-omniroute
ExecStart=/usr/bin/node --experimental-strip-types src/server.ts
Restart=always
RestartSec=5

Environment=NODE_ENV=production
Environment=FREEFLOW_PORT=28280
Environment=FREEFLOW_HOST=0.0.0.0
Environment=FREEFLOW_DATA_DIR=/opt/freeflow-omniroute/data

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/freeflow-omniroute/data
PrivateTmp=yes
MemoryMax=512M

StandardOutput=journal
StandardError=journal
SyslogIdentifier=freeflow-omniroute

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable freeflow-omniroute
systemctl start freeflow-omniroute

# ── 6. Wait for health ────────────────────────────────────────
echo ""
echo "→ Waiting for server to start..."
for i in $(seq 1 15); do
  if curl -sf http://localhost:28280/health > /dev/null 2>&1; then
    echo "  ✓ Server is healthy!"
    break
  fi
  sleep 1
done

# ── 7. Show status ────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  Setup complete!                                      ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "  Server:    http://0.0.0.0:28280"
echo "  Health:    curl http://localhost:28280/health"
echo "  Models:    curl http://localhost:28280/v1/models"
echo "  Logs:      journalctl -u freeflow-omniroute -f"
echo "  Status:    systemctl status freeflow-omniroute"
echo ""
echo "  ── OmniRoute Integration ──"
echo ""
echo "  Add to your OmniRoute .env:"
echo ""
echo "  OMNIROUTE_SELF_HOSTED_PROVIDERS='"
echo "    providers:"
echo "      - id: freeflow"
echo "        kind: openai"
echo "        baseUrl: http://<THIS_EC2_IP>:28280/v1"
echo "        model: deepseek-v4.1-flash-free"
echo "  '"
echo ""
echo "  Or add via OmniRoute Dashboard:"
echo "    1. Go to Providers → Add Connection"
echo "    2. Select 'OpenAI Compatible'"
echo "    3. Base URL: http://<THIS_EC2_IP>:28280/v1"
echo "    4. API Key: (leave empty unless FREEFLOW_REQUIRE_AUTH=true)"
echo ""
echo "  ── Security ──"
echo ""
echo "  To enable auth, edit the service:"
echo "    sudo systemctl edit freeflow-omniroute"
echo "    Add:"
echo "      [Service]"
echo "      Environment=FREEFLOW_API_TOKEN=your-secret-token"
echo "      Environment=FREEFLOW_REQUIRE_AUTH=true"
echo "    Then: sudo systemctl restart freeflow-omniroute"
echo ""
echo "  Don't forget to open port 28280 in your EC2 Security Group!"
echo ""

# Print health check
curl -s http://localhost:28280/health | node -e "
  process.stdin.resume();
  process.stdin.on('data', d => {
    const j = JSON.parse(d);
    console.log('  Health:', JSON.stringify(j, null, 2));
  });
" 2>/dev/null || true
