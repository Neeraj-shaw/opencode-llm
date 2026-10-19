"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import { useNotificationStore } from "@/store/notificationStore";

interface Relay {
  url: string;
  label?: string;
  failures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  coolingUntil: number;
  healthy?: boolean;
}

interface ClineAccount {
  slot: string;
  email?: string;
  expiresAt?: number;
  addedAt: string;
}

interface ModelItem {
  id: string;
  owned_by: string;
  context_window?: number;
  max_tokens?: number;
}

export default function FreeflowDashboardPage() {
  const [endpoint, setEndpoint] = useState<string>("http://127.0.0.1:28280");
  const [activeTab, setActiveTab] = useState<"relays" | "cline" | "models" | "tester">("relays");
  const [loading, setLoading] = useState<boolean>(true);
  const [healthData, setHealthData] = useState<any>(null);
  const [relays, setRelays] = useState<Relay[]>([]);
  const [clineAccounts, setClineAccounts] = useState<ClineAccount[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);

  // Forms
  const [relayForm, setRelayForm] = useState({ url: "", label: "", auth: "" });
  const [showAddRelay, setShowAddRelay] = useState(false);
  const [clineToken, setClineToken] = useState({ token: "", email: "", slot: "" });
  const [showManualCline, setShowManualCline] = useState(false);
  const [deviceLogin, setDeviceLogin] = useState<any>(null);
  const [pollStatus, setPollStatus] = useState<string>("");

  // Test
  const [testModel, setTestModel] = useState("deepseek-v4.1-flash-free");
  const [testPrompt, setTestPrompt] = useState("Write a haiku about cloud servers and AI.");
  const [testOutput, setTestOutput] = useState("");
  const [testing, setTesting] = useState(false);

  const addNotification = useNotificationStore((s) => s.addNotification);

  // Fetch all state from freeflow service
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, rRes, cRes, mRes] = await Promise.all([
        fetch(`${endpoint}/health`).then(r => r.json()).catch(() => null),
        fetch(`${endpoint}/v1/relays`).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`${endpoint}/v1/auth/cline/accounts`).then(r => r.json()).catch(() => ({ accounts: [] })),
        fetch(`${endpoint}/v1/models`).then(r => r.json()).catch(() => ({ data: [] })),
      ]);

      setHealthData(hRes);
      setRelays(Array.isArray(rRes?.data) ? rRes.data : []);
      setClineAccounts(Array.isArray(cRes?.accounts) ? cRes.accounts : []);
      setModels(Array.isArray(mRes?.data) ? mRes.data : []);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Relay actions
  const handleAddRelay = async () => {
    if (!relayForm.url.trim()) return;
    try {
      const res = await fetch(`${endpoint}/v1/relays`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(relayForm),
      });
      if (res.ok) {
        addNotification({ type: "success", message: "Relay added successfully" });
        setRelayForm({ url: "", label: "", auth: "" });
        setShowAddRelay(false);
        void fetchData();
      } else {
        addNotification({ type: "error", message: "Failed to add relay" });
      }
    } catch {
      addNotification({ type: "error", message: "Network error" });
    }
  };

  const handleDeleteRelay = async (url: string) => {
    if (!confirm(`Remove relay ${url}?`)) return;
    try {
      await fetch(`${endpoint}/v1/relays`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      addNotification({ type: "success", message: "Relay removed" });
      void fetchData();
    } catch {
      addNotification({ type: "error", message: "Failed to remove relay" });
    }
  };

  // Cline actions
  const startDeviceAuth = async () => {
    try {
      setPollStatus("Requesting device code...");
      const res = await fetch(`${endpoint}/v1/auth/cline/device`, { method: "POST" });
      const data = await res.json();
      if (!data.device_code) throw new Error(data.error || "Device auth failed");

      setDeviceLogin(data);
      setPollStatus("Waiting for confirmation in browser...");

      // Poll loop
      const timer = setInterval(async () => {
        try {
          const pRes = await fetch(`${endpoint}/v1/auth/cline/poll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_code: data.device_code }),
          });
          const pData = await pRes.json();
          if (pData.success) {
            clearInterval(timer);
            setPollStatus("✓ Login successful!");
            addNotification({ type: "success", message: "Cline account logged in successfully!" });
            setDeviceLogin(null);
            void fetchData();
          }
        } catch { }
      }, 5000);
    } catch (e: any) {
      setPollStatus(`Error: ${e.message}`);
    }
  };

  const handleManualCline = async () => {
    if (!clineToken.token.trim()) return;
    try {
      const res = await fetch(`${endpoint}/v1/auth/cline/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clineToken),
      });
      if (res.ok) {
        addNotification({ type: "success", message: "Cline token saved" });
        setClineToken({ token: "", email: "", slot: "" });
        setShowManualCline(false);
        void fetchData();
      }
    } catch {
      addNotification({ type: "error", message: "Failed to save Cline token" });
    }
  };

  const handleDeleteCline = async (slot: string) => {
    if (!confirm(`Delete Cline slot ${slot}?`)) return;
    try {
      await fetch(`${endpoint}/v1/auth/cline/${encodeURIComponent(slot)}`, { method: "DELETE" });
      addNotification({ type: "success", message: "Account removed" });
      void fetchData();
    } catch {
      addNotification({ type: "error", message: "Failed to remove account" });
    }
  };

  // Run Test
  const handleRunTest = async () => {
    setTesting(true);
    setTestOutput("Requesting completion from " + testModel + "...");
    try {
      const res = await fetch(`${endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: "user", content: testPrompt }],
          stream: false,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setTestOutput("Error: " + JSON.stringify(data.error, null, 2));
      } else {
        setTestOutput(data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2));
      }
    } catch (err: any) {
      setTestOutput("Request failed: " + err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">FreeFlow Models & Proxies</h1>
            <Badge variant={healthData ? "success" : "error"} size="sm">
              {healthData ? "Online (35 Models)" : "Service Offline"}
            </Badge>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Zero-key access to 35 curated models (OpenCode Zen, KiloCode, OVHcloud, Cline) with egress relay rotation.
          </p>
        </div>

        {/* Endpoint Selector */}
        <div className="flex items-center gap-2">
          <input
            className="border border-border rounded-lg px-3 py-1.5 bg-surface text-xs font-mono w-64"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://127.0.0.1:28280"
          />
          <Button variant="secondary" size="sm" onClick={() => void fetchData()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-2">
        {(["relays", "cline", "models", "tester"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            {tab === "relays" && "Egress Relays & Proxies"}
            {tab === "cline" && "Cline Accounts"}
            {tab === "models" && "Model Catalog (35)"}
            {tab === "tester" && "Prompt Tester"}
          </button>
        ))}
      </div>

      {/* TAB 1: RELAYS */}
      {activeTab === "relays" && (
        <div className="space-y-4">
          <Card>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">OpenCode Egress Relay Pool</h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    Spreads outbound requests across edge IPs (Cloudflare Workers, Deno, WARP) to eliminate 429 rate limits.
                  </p>
                </div>
                <Button size="sm" onClick={() => setShowAddRelay(!showAddRelay)}>
                  {showAddRelay ? "Cancel" : "Add Relay"}
                </Button>
              </div>

              {showAddRelay && (
                <div className="bg-surface/50 border border-border rounded-lg p-3 space-y-3 mt-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">Relay URL *</label>
                      <input
                        className="w-full border border-border rounded-lg px-3 py-1.5 bg-surface text-xs"
                        placeholder="https://my-relay.workers.dev"
                        value={relayForm.url}
                        onChange={(e) => setRelayForm({ ...relayForm, url: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Label (optional)</label>
                      <input
                        className="w-full border border-border rounded-lg px-3 py-1.5 bg-surface text-xs"
                        placeholder="cf-worker-1"
                        value={relayForm.label}
                        onChange={(e) => setRelayForm({ ...relayForm, label: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Secret Auth (optional)</label>
                      <input
                        type="password"
                        className="w-full border border-border rounded-lg px-3 py-1.5 bg-surface text-xs"
                        placeholder="x-relay-auth"
                        value={relayForm.auth}
                        onChange={(e) => setRelayForm({ ...relayForm, auth: e.target.value })}
                      />
                    </div>
                  </div>
                  <Button size="sm" onClick={handleAddRelay} disabled={!relayForm.url.trim()}>
                    Save Relay
                  </Button>
                </div>
              )}

              {/* Relay list */}
              <div className="mt-4">
                {relays.length === 0 ? (
                  <p className="text-xs text-text-muted py-2">
                    No relays configured. Requests go direct to upstream OpenCode Zen.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {relays.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border border-border rounded-lg p-3 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`size-2 rounded-full ${
                              Date.now() < r.coolingUntil ? "bg-amber-500" : "bg-green-500"
                            }`}
                          />
                          <div>
                            <span className="font-semibold">{r.label || `relay-${i + 1}`}</span>
                            <span className="font-mono text-text-muted ml-2">{r.url}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge size="sm" variant={Date.now() < r.coolingUntil ? "warning" : "success"}>
                            {Date.now() < r.coolingUntil ? "Cooling Down" : "Healthy"}
                          </Badge>
                          <button
                            onClick={() => handleDeleteRelay(r.url)}
                            className="text-red-500 hover:underline px-2"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2: CLINE */}
      {activeTab === "cline" && (
        <div className="space-y-4">
          <Card>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Cline Multi-Account Login Pool</h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    Save multiple Cline accounts. Requests automatically roll to the next account when daily quotas are hit.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={startDeviceAuth}>
                    Start WorkOS Login
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowManualCline(!showManualCline)}>
                    Paste Token
                  </Button>
                </div>
              </div>

              {/* Device flow banner */}
              {deviceLogin && (
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 space-y-2 mt-3">
                  <h3 className="text-xs font-semibold text-primary">1. Authorize in Browser</h3>
                  <p className="text-xs text-text-muted">
                    Click the link below and confirm the user code in your browser:
                  </p>
                  <div className="flex items-center gap-3 my-2">
                    <a
                      href={deviceLogin.verification_uri_complete || deviceLogin.verification_uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block bg-primary text-white text-xs px-3 py-1.5 rounded font-medium"
                    >
                      Open Verification Link
                    </a>
                    <span className="font-mono font-bold text-sm bg-surface px-2 py-1 rounded border border-border">
                      {deviceLogin.user_code}
                    </span>
                  </div>
                  <p className="text-xs text-amber-500 font-medium">{pollStatus}</p>
                </div>
              )}

              {/* Manual form */}
              {showManualCline && (
                <div className="bg-surface/50 border border-border rounded-lg p-3 space-y-3 mt-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium mb-1">Cline Token (workos:... or JWT) *</label>
                      <input
                        type="password"
                        className="w-full border border-border rounded-lg px-3 py-1.5 bg-surface text-xs"
                        placeholder="workos:eyJ..."
                        value={clineToken.token}
                        onChange={(e) => setClineToken({ ...clineToken, token: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Email (optional)</label>
                      <input
                        className="w-full border border-border rounded-lg px-3 py-1.5 bg-surface text-xs"
                        placeholder="you@example.com"
                        value={clineToken.email}
                        onChange={(e) => setClineToken({ ...clineToken, email: e.target.value })}
                      />
                    </div>
                  </div>
                  <Button size="sm" onClick={handleManualCline} disabled={!clineToken.token.trim()}>
                    Save Token
                  </Button>
                </div>
              )}

              {/* Account List */}
              <div className="mt-4">
                {clineAccounts.length === 0 ? (
                  <p className="text-xs text-text-muted py-2">
                    No Cline logins saved. Click "Start WorkOS Login" above to connect an account.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {clineAccounts.map((acc) => (
                      <div
                        key={acc.slot}
                        className="flex items-center justify-between border border-border rounded-lg p-3 text-xs"
                      >
                        <div>
                          <span className="font-semibold">{acc.slot}</span>
                          <span className="text-text-muted ml-2">{acc.email || "No email"}</span>
                          <span className="text-[10px] text-text-muted ml-2">
                            Added: {new Date(acc.addedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteCline(acc.slot)}
                          className="text-red-500 hover:underline px-2"
                        >
                          Delete Slot
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: MODELS */}
      {activeTab === "models" && (
        <Card>
          <div className="p-4 space-y-3">
            <h2 className="text-sm font-semibold">Catalog of 35 Free Models</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-text-muted uppercase text-[10px]">
                    <th className="py-2">Model ID</th>
                    <th className="py-2">Provider</th>
                    <th className="py-2">Context Window</th>
                    <th className="py-2">Max Output</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {models.map((m) => (
                    <tr key={m.id} className="hover:bg-surface/50">
                      <td className="py-2 font-mono font-medium">{m.id}</td>
                      <td className="py-2">
                        <Badge size="sm" variant="info">{m.owned_by}</Badge>
                      </td>
                      <td className="py-2">
                        {m.context_window ? `${(m.context_window / 1000).toFixed(0)}K` : "—"}
                      </td>
                      <td className="py-2">
                        {m.max_tokens ? `${(m.max_tokens / 1000).toFixed(0)}K` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* TAB 4: TESTER */}
      {activeTab === "tester" && (
        <Card>
          <div className="p-4 space-y-4">
            <h2 className="text-sm font-semibold">Test Completion Prompt</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Model</label>
                <select
                  className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-xs"
                  value={testModel}
                  onChange={(e) => setTestModel(e.target.value)}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} [{m.owned_by}]
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Prompt</label>
              <textarea
                className="w-full border border-border rounded-lg p-3 bg-surface text-xs"
                rows={3}
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={handleRunTest} disabled={testing}>
              {testing ? "Running..." : "Send Test Request"}
            </Button>

            {testOutput && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-text-muted mb-1">Response:</label>
                <pre className="bg-surface/80 border border-border rounded-lg p-3 text-xs font-mono whitespace-pre-wrap">
                  {testOutput}
                </pre>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
