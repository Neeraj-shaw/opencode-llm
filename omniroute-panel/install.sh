#!/bin/bash
#
# Install FreeFlow Settings Panel into OmniRoute
# Usage: sudo ./install.sh [path-to-omniroute]
#
set -euo pipefail

OMNIROUTE_DIR="${1:-/opt/omniroute}"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  Installing FreeFlow Panel into OmniRoute              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Find OmniRoute directory
if [[ ! -f "${OMNIROUTE_DIR}/package.json" ]]; then
  echo "Checking common locations..."
  for loc in /opt/omniroute /home/ubuntu/OmniRoute /home/ubuntu/omniroute /var/www/omniroute ./OmniRoute ../OmniRoute; do
    if [[ -f "${loc}/package.json" ]]; then
      OMNIROUTE_DIR="$loc"
      break
    fi
  done
fi

if [[ ! -f "${OMNIROUTE_DIR}/package.json" ]]; then
  echo "✗ OmniRoute repository not found at ${OMNIROUTE_DIR}."
  echo "  Please provide the path: sudo ./install.sh /path/to/omniroute"
  exit 1
fi

echo "✓ Found OmniRoute at: ${OMNIROUTE_DIR}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_ROUTE_DIR="${OMNIROUTE_DIR}/src/app/(dashboard)/dashboard/freeflow"

# 1. Create route directory
echo "→ Creating dashboard route: ${TARGET_ROUTE_DIR}"
mkdir -p "${TARGET_ROUTE_DIR}"

# 2. Copy components
echo "→ Copying FreeflowDashboardPage.tsx and page.tsx..."
cp "${SCRIPT_DIR}/FreeflowDashboardPage.tsx" "${TARGET_ROUTE_DIR}/"
cp "${SCRIPT_DIR}/page.tsx" "${TARGET_ROUTE_DIR}/"

# 3. Add to OmniRoute sidebar sections if not already present
SECTIONS_FILE="${OMNIROUTE_DIR}/src/shared/constants/sidebarVisibility/sections.ts"
if [[ -f "${SECTIONS_FILE}" ]]; then
  echo "→ Checking sidebar navigation in ${SECTIONS_FILE}..."
  if grep -q "dashboard/freeflow" "${SECTIONS_FILE}"; then
    echo "  ✓ Freeflow is already registered in sidebar"
  else
    echo "  → Registering Freeflow in sidebar navigation..."
    # Inject into OMNI_PROXY_ITEMS right after providers
    node -e "
      const fs = require('fs');
      let code = fs.readFileSync('${SECTIONS_FILE}', 'utf8');
      const item = \`  {
    id: \"freeflow\",
    href: \"/dashboard/freeflow\",
    i18nKey: \"freeflow\",
    labelFallback: \"FreeFlow Models & Proxies\",
    subtitleKey: \"freeflowSubtitle\",
    subtitleFallback: \"35 free models, relay pool, Cline & Kilo\",
    icon: \"stream\",
  },\n\`;
      if (code.includes('id: \"providers\",')) {
        code = code.replace(/(id:\s*\"providers\",[\s\S]*?\},)/, '\$1\n' + item);
        fs.writeFileSync('${SECTIONS_FILE}', code, 'utf8');
        console.log('  ✓ Sidebar updated!');
      } else {
        console.log('  Notice: Could not auto-patch sections.ts; route is accessible at /dashboard/freeflow');
      }
    "
  fi
fi

# 4. Configure OmniRoute .env to point to FreeFlow
ENV_FILE="${OMNIROUTE_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  echo "→ Checking OmniRoute .env configuration..."
  if grep -q "id: freeflow" "${ENV_FILE}"; then
    echo "  ✓ OmniRoute .env already has freeflow provider configured"
  else
    echo "  → Adding FreeFlow self-hosted provider to ${ENV_FILE}..."
    cat >> "${ENV_FILE}" << 'EOF'

# FreeFlow 35 Free Models Provider
OMNIROUTE_SELF_HOSTED_PROVIDERS='
  providers:
    - id: freeflow
      kind: openai
      baseUrl: http://127.0.0.1:28280/v1
      model: deepseek-v4.1-flash-free
'
EOF
    echo "  ✓ .env updated!"
  fi
fi

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  Installation complete!                               ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "  1. FreeFlow Settings Panel is installed at:"
echo "     http://<YOUR_EC2_IP>:20128/dashboard/freeflow"
echo ""
echo "  2. You can also access the standalone panel directly at:"
echo "     http://<YOUR_EC2_IP>:28280/dashboard"
echo ""
echo "  3. Rebuild or restart OmniRoute on EC2:"
echo "     cd ${OMNIROUTE_DIR}"
echo "     pnpm build   # or pm2 restart omniroute / docker restart omniroute"
echo ""
