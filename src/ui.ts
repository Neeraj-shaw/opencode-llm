/**
 * freeflow-omniroute — Embedded Web Management Dashboard HTML
 *
 * Self-contained HTML/CSS/JS dashboard served at GET / or GET /dashboard
 * Allows visual management of:
 * - Egress Relays (add/remove/test)
 * - Cline Accounts (WorkOS device flow login + manual tokens)
 * - KiloCode settings
 * - Model catalog inspection and test prompts
 */

export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Freeflow OmniRoute Manager</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
    }
    .header-title h1 { font-size: 24px; font-weight: 700; color: #fff; }
    .header-title p { font-size: 14px; color: var(--text-muted); }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 8px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn:hover { color: #fff; background: var(--card-bg); }
    .tab-btn.active { color: #fff; background: var(--primary); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .card h2 { font-size: 18px; margin-bottom: 8px; color: #fff; }
    .card p.desc { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; }

    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
    }
    .stat-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .stat-val { font-size: 28px; font-weight: 700; color: #fff; margin-top: 4px; }

    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    th { text-align: left; padding: 10px; color: var(--text-muted); border-bottom: 1px solid var(--card-border); font-size: 12px; text-transform: uppercase; }
    td { padding: 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    tr:hover td { background: rgba(255,255,255,0.02); }

    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn-danger { background: var(--danger); }
    .btn-danger:hover { background: #dc2626; }
    .btn-secondary { background: #475569; }
    .btn-secondary:hover { background: #64748b; }

    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 13px; margin-bottom: 6px; color: var(--text-muted); font-weight: 500; }
    .form-control {
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 10px;
      color: #fff;
      font-size: 14px;
    }
    .form-control:focus { outline: none; border-color: var(--primary); }
    .form-row { display: flex; gap: 12px; align-items: flex-end; }
    .form-row .form-group { flex: 1; margin-bottom: 0; }

    .pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .pill-green { background: rgba(16,185,129,0.2); color: var(--success); }
    .pill-yellow { background: rgba(245,158,11,0.2); color: var(--warning); }
    .pill-blue { background: rgba(59,130,246,0.2); color: var(--primary); }

    .test-box {
      background: #0f172a;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
    }
    pre {
      background: #090d16;
      padding: 12px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 13px;
      color: #38bdf8;
      overflow-x: auto;
      max-height: 250px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-title">
        <h1>Freeflow OmniRoute Control Panel</h1>
        <p>OpenAI-compatible gateway exposing 35 free models for OmniRoute on EC2</p>
      </div>
      <div>
        <span class="badge" id="server-status">● Server Online</span>
      </div>
    </header>

    <div class="grid-4">
      <div class="stat-card">
        <div class="stat-label">Total Free Models</div>
        <div class="stat-val" id="stat-models">35</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Egress Relays</div>
        <div class="stat-val" id="stat-relays">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Saved Cline Accounts</div>
        <div class="stat-val" id="stat-cline">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Upstream Lanes</div>
        <div class="stat-val">4</div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('relays')">Egress Relays & Proxies</button>
      <button class="tab-btn" onclick="switchTab('cline')">Cline Multi-Accounts</button>
      <button class="tab-btn" onclick="switchTab('models')">35 Free Models Catalog</button>
      <button class="tab-btn" onclick="switchTab('playground')">Model Tester</button>
      <button class="tab-btn" onclick="switchTab('omniroute')">OmniRoute Integration</button>
    </div>

    <!-- TAB 1: RELAYS -->
    <div id="tab-relays" class="tab-content active">
      <div class="card">
        <h2>Egress Relay Pool</h2>
        <p class="desc">Distribute requests across multiple Cloudflare Workers, Deno Deploy, Vercel Edge, or WARP proxies to eliminate 429 rate limits on OpenCode Zen.</p>
        
        <div class="form-row" style="margin-bottom: 20px;">
          <div class="form-group" style="flex: 2;">
            <label>Relay URL (e.g. https://relay1.workers.dev)</label>
            <input type="text" id="relay-url" class="form-control" placeholder="https://your-worker.workers.dev">
          </div>
          <div class="form-group" style="flex: 1;">
            <label>Friendly Label</label>
            <input type="text" id="relay-label" class="form-control" placeholder="cf-worker-1">
          </div>
          <div class="form-group" style="flex: 1;">
            <label>Secret Auth (optional)</label>
            <input type="password" id="relay-auth" class="form-control" placeholder="x-relay-auth">
          </div>
          <button class="btn" onclick="addRelay()" style="height: 42px;">Add Relay</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Relay Target URL</th>
              <th>Status</th>
              <th>Failures</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="relays-table-body">
            <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No relays configured. Requests go direct to upstream.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 2: CLINE -->
    <div id="tab-cline" class="tab-content">
      <div class="card">
        <h2>Cline Account Pool & Device Auth</h2>
        <p class="desc">Cline provides free promo models (Muse Spark 1.3, GLM 5.3 Flash). Save multiple logins to automatically rotate when daily quotas are reached.</p>
        
        <div style="display: flex; gap: 16px; margin-bottom: 20px;">
          <button class="btn" onclick="startDeviceLogin()" id="btn-start-login">Start WorkOS Device Login</button>
          <button class="btn btn-secondary" onclick="toggleManualToken()">Paste Token Manually</button>
        </div>

        <div id="device-login-box" class="test-box" style="display: none; margin-bottom: 20px;">
          <h3 style="font-size: 15px; margin-bottom: 8px;">1. Open the Verification Link in your Browser</h3>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">Visit the link below and confirm the user code:</p>
          <p style="margin-bottom: 12px;">
            <a id="device-auth-link" href="#" target="_blank" class="btn" style="display: inline-block; text-decoration: none;">Open Login Link</a>
            <span style="margin-left: 12px; font-weight: 700; font-size: 16px;" id="device-user-code">CODE-HERE</span>
          </p>
          <div id="poll-status" style="font-size: 13px; color: var(--warning);">Waiting for your confirmation in browser...</div>
        </div>

        <div id="manual-token-box" class="test-box" style="display: none; margin-bottom: 20px;">
          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label>Cline Token (workos:... or JWT)</label>
              <input type="password" id="manual-token" class="form-control" placeholder="workos:eyJ...">
            </div>
            <div class="form-group" style="flex: 1;">
              <label>Email (optional)</label>
              <input type="text" id="manual-email" class="form-control" placeholder="user@example.com">
            </div>
            <div class="form-group" style="flex: 1;">
              <label>Slot Name</label>
              <input type="text" id="manual-slot" class="form-control" placeholder="slot-1">
            </div>
            <button class="btn" onclick="saveManualToken()" style="height: 42px;">Save Token</button>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Slot</th>
              <th>Email</th>
              <th>Added At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="cline-table-body">
            <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No Cline logins saved. Click "Start WorkOS Device Login" above.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: MODELS -->
    <div id="tab-models" class="tab-content">
      <div class="card">
        <h2>35 Free Curated Models</h2>
        <p class="desc">All models are available via standard OpenAI /v1/chat/completions endpoint without personal API keys.</p>
        <table>
          <thead>
            <tr>
              <th>Model ID / Alias</th>
              <th>Provider</th>
              <th>Context</th>
              <th>Max Output</th>
              <th>Reasoning</th>
            </tr>
          </thead>
          <tbody id="models-table-body">
            <tr><td colspan="5">Loading models...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 4: PLAYGROUND -->
    <div id="tab-playground" class="tab-content">
      <div class="card">
        <h2>Model Quick Tester</h2>
        <p class="desc">Send a test prompt directly to verify your server and upstreams are functioning properly.</p>
        <div class="form-group">
          <label>Select Model</label>
          <select id="test-model" class="form-control" style="width: 100%;">
            <option value="deepseek-v4.1-flash-free">DeepSeek V4.1 Flash [OpenCode 1M]</option>
            <option value="space-bunny-free">Space Bunny Free [OpenCode 1M]</option>
            <option value="mimo-v2.6-flash-free">MiMo V2.6 Flash [OpenCode 1M]</option>
            <option value="kilo-auto">Kilo Auto [KiloCode Gateway]</option>
            <option value="gpt-oss-120b">GPT-OSS 120B [OVHcloud AI Endpoints]</option>
          </select>
        </div>
        <div class="form-group">
          <label>Prompt</label>
          <textarea id="test-prompt" class="form-control" rows="3">Write a haiku about cloud servers and artificial intelligence.</textarea>
        </div>
        <button class="btn" onclick="runPrompt()" id="btn-run-prompt">Send Request</button>
        <div id="prompt-result" class="test-box" style="display: none; margin-top: 16px;">
          <h4 style="font-size: 13px; color: var(--text-muted); margin-bottom: 6px;">Output:</h4>
          <pre id="prompt-output">Waiting...</pre>
        </div>
      </div>
    </div>

    <!-- TAB 5: OMNIROUTE INTEGRATION -->
    <div id="tab-omniroute" class="tab-content">
      <div class="card">
        <h2>Connecting to OmniRoute</h2>
        <p class="desc">Integrate this server into OmniRoute running on your EC2 instance.</p>
        
        <h3 style="font-size: 15px; margin-bottom: 8px;">Method 1: OmniRoute .env (Self-Hosted Provider)</h3>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">Add the following block to your OmniRoute <code>.env</code> file:</p>
        <pre>OMNIROUTE_SELF_HOSTED_PROVIDERS='
  providers:
    - id: freeflow
      kind: openai
      baseUrl: http://127.0.0.1:28280/v1
      model: deepseek-v4.1-flash-free
'</pre>

        <h3 style="font-size: 15px; margin: 20px 0 8px;">Method 2: OmniRoute Web Dashboard</h3>
        <ol style="font-size: 14px; color: var(--text-muted); padding-left: 20px; line-height: 1.8;">
          <li>Navigate to your OmniRoute Dashboard (e.g. <code>http://&lt;EC2_IP&gt;:20128</code>)</li>
          <li>Go to <strong>Providers</strong> → <strong>Add Connection</strong></li>
          <li>Select <strong>OpenAI Compatible</strong></li>
          <li>Set <strong>Base URL:</strong> <code>http://127.0.0.1:28280/v1</code></li>
          <li>Leave <strong>API Key</strong> blank (or set your <code>FREEFLOW_API_TOKEN</code>)</li>
          <li>Save the connection</li>
        </ol>
      </div>
    </div>
  </div>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tab-' + tabId).classList.add('active');
    }

    async function loadHealth() {
      try {
        const res = await fetch('/health');
        const data = await res.json();
        document.getElementById('stat-models').textContent = data.models || 35;
        document.getElementById('stat-relays').textContent = data.relays?.total || 0;
        document.getElementById('stat-cline').textContent = data.cline?.accountsCount || 0;
        renderRelays(data.relays?.list || []);
      } catch (e) {
        document.getElementById('server-status').textContent = '● Offline';
        document.getElementById('server-status').style.color = '#ef4444';
      }
    }

    function renderRelays(relays) {
      const tbody = document.getElementById('relays-table-body');
      if (!relays || relays.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No relays configured. Requests route direct to upstream.</td></tr>';
        return;
      }
      tbody.innerHTML = relays.map(r => \`
        <tr>
          <td><strong>\${r.label}</strong></td>
          <td><code>\${r.url}</code></td>
          <td><span class="pill \${r.healthy ? 'pill-green' : 'pill-yellow'}">\${r.healthy ? 'HEALTHY' : 'COOLING DOWN'}</span></td>
          <td>\${r.failures || 0}</td>
          <td><button class="btn btn-danger" onclick="deleteRelay('\${r.url}')">Remove</button></td>
        </tr>
      \`).join('');
    }

    async function addRelay() {
      const url = document.getElementById('relay-url').value.trim();
      const label = document.getElementById('relay-label').value.trim();
      const auth = document.getElementById('relay-auth').value.trim();
      if (!url) return alert('Relay URL is required');
      await fetch('/v1/relays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label, auth })
      });
      document.getElementById('relay-url').value = '';
      document.getElementById('relay-label').value = '';
      document.getElementById('relay-auth').value = '';
      loadHealth();
    }

    async function deleteRelay(url) {
      if (!confirm('Remove relay ' + url + '?')) return;
      await fetch('/v1/relays', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      loadHealth();
    }

    async function loadClineAccounts() {
      try {
        const res = await fetch('/v1/auth/cline/accounts');
        const data = await res.json();
        const tbody = document.getElementById('cline-table-body');
        if (!data.accounts || data.accounts.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No Cline logins saved. Click "Start WorkOS Device Login" above.</td></tr>';
          return;
        }
        tbody.innerHTML = data.accounts.map(a => \`
          <tr>
            <td><strong>\${a.slot}</strong></td>
            <td>\${a.email || '—'}</td>
            <td>\${new Date(a.addedAt).toLocaleString()}</td>
            <td><button class="btn btn-danger" onclick="deleteClineSlot('\${a.slot}')">Remove</button></td>
          </tr>
        \`).join('');
      } catch (e) {}
    }

    async function deleteClineSlot(slot) {
      if (!confirm('Remove Cline login slot ' + slot + '?')) return;
      await fetch('/v1/auth/cline/' + encodeURIComponent(slot), { method: 'DELETE' });
      loadClineAccounts();
      loadHealth();
    }

    let pollInterval = null;
    async function startDeviceLogin() {
      const btn = document.getElementById('btn-start-login');
      btn.disabled = true;
      try {
        const res = await fetch('/v1/auth/cline/device', { method: 'POST' });
        const data = await res.json();
        if (!data.device_code) throw new Error(data.error || 'Failed to start device login');

        document.getElementById('device-login-box').style.display = 'block';
        document.getElementById('device-user-code').textContent = data.user_code;
        document.getElementById('device-auth-link').href = data.verification_uri_complete || data.verification_uri;

        // Auto poll
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(async () => {
          try {
            const pRes = await fetch('/v1/auth/cline/poll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ device_code: data.device_code })
            });
            const pData = await pRes.json();
            if (pData.success) {
              clearInterval(pollInterval);
              document.getElementById('poll-status').innerHTML = '<span style="color: var(--success); font-weight: 700;">✓ Login approved and saved!</span>';
              btn.disabled = false;
              loadClineAccounts();
              loadHealth();
            }
          } catch (e) {}
        }, 5000);
      } catch (err) {
        alert('Device login error: ' + err.message);
        btn.disabled = false;
      }
    }

    function toggleManualToken() {
      const el = document.getElementById('manual-token-box');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    async function saveManualToken() {
      const token = document.getElementById('manual-token').value.trim();
      const email = document.getElementById('manual-email').value.trim();
      const slot = document.getElementById('manual-slot').value.trim();
      if (!token) return alert('Token is required');
      await fetch('/v1/auth/cline/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email, slot })
      });
      document.getElementById('manual-token').value = '';
      document.getElementById('manual-token-box').style.display = 'none';
      loadClineAccounts();
      loadHealth();
    }

    async function loadModels() {
      try {
        const res = await fetch('/v1/models');
        const json = await res.json();
        const tbody = document.getElementById('models-table-body');
        tbody.innerHTML = json.data.map(m => \`
          <tr>
            <td><strong>\${m.id}</strong></td>
            <td><span class="pill pill-blue">\${m.owned_by}</span></td>
            <td>\${m.context_window ? (m.context_window / 1000).toFixed(0) + 'K' : '—'}</td>
            <td>\${m.max_tokens ? (m.max_tokens / 1000).toFixed(0) + 'K' : '—'}</td>
            <td>\${m.context_window >= 1000000 ? '<span class="pill pill-green">1M Ctx</span>' : '<span class="pill pill-yellow">Standard</span>'}</td>
          </tr>
        \`).join('');

        // Populate test dropdown
        const select = document.getElementById('test-model');
        select.innerHTML = json.data.map(m => \`<option value="\${m.id}">\${m.id} [\${m.owned_by}]</option>\`).join('');
      } catch (e) {}
    }

    async function runPrompt() {
      const model = document.getElementById('test-model').value;
      const prompt = document.getElementById('test-prompt').value;
      const btn = document.getElementById('btn-run-prompt');
      const box = document.getElementById('prompt-result');
      const out = document.getElementById('prompt-output');

      btn.disabled = true;
      btn.textContent = 'Generating...';
      box.style.display = 'block';
      out.textContent = 'Contacting upstream model...';

      try {
        const res = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            stream: false
          })
        });
        const data = await res.json();
        if (data.error) {
          out.textContent = 'Error: ' + JSON.stringify(data.error, null, 2);
        } else {
          out.textContent = data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);
        }
      } catch (err) {
        out.textContent = 'Request failed: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send Request';
      }
    }

    loadHealth();
    loadClineAccounts();
    loadModels();
  </script>
</body>
</html>`;
}
