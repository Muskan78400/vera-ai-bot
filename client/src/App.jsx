import { useEffect, useState, useCallback } from 'react';
import {
  Tag, Store, Users, Zap, Activity, FlaskConical, Wand2,
  MessageSquare, Sparkles, Loader2,
} from 'lucide-react';
import ConversationViewer from './components/ConversationViewer.jsx';
import TriggerBuilder from './components/TriggerBuilder.jsx';
import QualityBadges from './components/QualityBadges.jsx';

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `Uptime: ${h}:${m}:${s}`;
}

const TRIGGER_OPTIONS = [
  { value: 'research_digest', label: 'Research Digest Release (external)' },
  { value: 'recall_due', label: 'Recall Due (customer-facing)' },
  { value: 'perf_dip', label: 'Performance Dip (internal)' },
  { value: 'ipl_match_today', label: 'IPL Match Day (external)' },
  { value: 'hostile', label: 'Hostile / Opt-out (reply test)' },
];

export default function App() {
  const [uptimeText, setUptimeText] = useState('Uptime: 00:00:00');
  const [storageBackend, setStorageBackend] = useState('');
  const [counts, setCounts] = useState({ category: 0, merchant: 0, customer: 0, trigger: 0 });
  const [engineMeta, setEngineMeta] = useState('Loading metadata...');
  const [logs, setLogs] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const [offline, setOffline] = useState(false);
  const [rightTab, setRightTab] = useState('sandbox'); // 'sandbox' | 'builder'
  const [warmupStatus, setWarmupStatus] = useState('');
  const [isWarmingUp, setIsWarmingUp] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch('/v1/healthz');
      const data = await res.json();
      setUptimeText(formatUptime(data.uptime_seconds));
      setStorageBackend(data.storage || '');
      setCounts(data.contexts_loaded || { category: 0, merchant: 0, customer: 0, trigger: 0 });
      setOffline(false);
    } catch {
      setOffline(true);
      setUptimeText('Server Offline');
    }
  }, []);

  const refreshMetadata = useCallback(async () => {
    try {
      const res = await fetch('/v1/metadata');
      const data = await res.json();
      setEngineMeta(`Running ${data.team_name} v${data.version} | Engine: ${data.model}`);
    } catch {
      // silent — metadata is non-critical
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      setLogs([...data].reverse());
    } catch {
      // silent
    }
  }, []);

  const refreshMerchants = useCallback(async () => {
    try {
      const res = await fetch('/api/contexts');
      const data = await res.json();
      setMerchants(data.merchants || []);
    } catch {
      // silent
    }
  }, []);

  async function runWarmup() {
    setIsWarmingUp(true);
    setWarmupStatus('Loading bundled dataset…');
    try {
      const res = await fetch('/api/warmup', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const c = data.counts;
        setWarmupStatus(
          `Loaded: ${c.category} categories, ${c.merchant} merchants, ${c.customer} customers, ${c.trigger} triggers.`
        );
        await refreshStats();
        await refreshMerchants();
      } else {
        setWarmupStatus(`Failed: ${data.error || 'unknown error'}`);
      }
    } catch (err) {
      setWarmupStatus(`Connection error: ${err.message}`);
    } finally {
      setIsWarmingUp(false);
    }
  }

  useEffect(() => {
    refreshMetadata();
    refreshStats();
    refreshLogs();
    refreshMerchants();

    const statsTimer = setInterval(refreshStats, 2000);
    const logsTimer = setInterval(refreshLogs, 2000);
    const merchantsTimer = setInterval(refreshMerchants, 5000);

    return () => {
      clearInterval(statsTimer);
      clearInterval(logsTimer);
      clearInterval(merchantsTimer);
    };
  }, [refreshStats, refreshLogs, refreshMerchants, refreshMetadata]);

  return (
    <>
      <div className="glass-bg" />

      <header className="app-header">
        <div className="logo-area">
          <div className="logo-orb" />
          <div className="logo-text">
            <h1>New Vera 2.0</h1>
            <span>Upgraded Merchant AI Engine {storageBackend && `· ${storageBackend}`}</span>
          </div>
        </div>
        <div className="system-status">
          <div className={`status-indicator ${offline ? '' : 'online'}`} />
          <span>{uptimeText}</span>
        </div>
      </header>

      <div className="warmup-bar">
        <button className="warmup-button" onClick={runWarmup} disabled={isWarmingUp}>
          {isWarmingUp ? <Loader2 size={16} strokeWidth={2.4} className="spin" /> : <Zap size={16} strokeWidth={2.4} />}
          {isWarmingUp ? 'Loading…' : 'One-Click Warmup'}
        </button>
        {warmupStatus && <span className="warmup-status">{warmupStatus}</span>}
        <span className="warmup-hint">Loads the bundled dataset/ folder directly — no judge_simulator.py needed.</span>
      </div>

      <main className="dashboard-grid">
        <section className="metrics-row">
          <MetricCard label="Categories Loaded" value={counts.category} icon={Tag} accent="#14B8A6" />
          <MetricCard label="Merchants Synced" value={counts.merchant} icon={Store} accent="#5B2CE0" />
          <MetricCard label="Customers Active" value={counts.customer} icon={Users} accent="#EC1279" />
          <MetricCard label="Triggers Tracked" value={counts.trigger} icon={Zap} accent="#ffa502" />
        </section>

        <section className="console-row">
          <div className="panel glass-card scroll-panel flex-col">
            <div className="panel-header">
              <h2>
                <Activity size={18} strokeWidth={2.2} />
                Activity Console
              </h2>
              <div className="badge glow-purple">
                <span className="live-dot" /> Live Feed
              </div>
            </div>
            <div className="panel-body logs-container">
              {logs.length === 0 ? (
                <div className="empty-state">
                  <Sparkles size={22} strokeWidth={1.6} />
                  <span>Awaiting triggers — run warmup, then simulate a composition to see activity here.</span>
                </div>
              ) : (
                logs.map((log, i) => <LogEntry key={i} log={log} />)
              )}
            </div>
          </div>

          <div className="panel glass-card flex-col">
            <div className="panel-header tabs-header">
              <div className="tab-switch">
                <button
                  className={`tab-btn ${rightTab === 'sandbox' ? 'active' : ''}`}
                  onClick={() => setRightTab('sandbox')}
                >
                  <FlaskConical size={15} strokeWidth={2.2} />
                  Sandbox
                </button>
                <button
                  className={`tab-btn ${rightTab === 'builder' ? 'active' : ''}`}
                  onClick={() => setRightTab('builder')}
                >
                  <Wand2 size={15} strokeWidth={2.2} />
                  Trigger Builder
                </button>
              </div>
            </div>
            <div className="panel-body debugger-area" style={{ display: rightTab === 'sandbox' ? 'flex' : 'none' }}>
              <CompositionSandbox merchants={merchants} />
            </div>
            <div style={{ display: rightTab === 'builder' ? 'block' : 'none' }}>
              <TriggerBuilder merchants={merchants} />
            </div>
          </div>
        </section>

        <section className="conversation-row">
          <ConversationViewer />
        </section>
      </main>

      <footer className="app-footer">
        <div className="engine-meta">{engineMeta}</div>
        <div className="copyright">magicpin AI Challenge Submissions</div>
      </footer>
    </>
  );
}

function CompositionSandbox({ merchants }) {
  const [selectedMerchant, setSelectedMerchant] = useState('');
  const [selectedTrigger, setSelectedTrigger] = useState(TRIGGER_OPTIONS[0].value);
  const [previewBody, setPreviewBody] = useState('Outputs will appear here after simulation...');
  const [previewDiagnostics, setPreviewDiagnostics] = useState('Diagnostics details...');
  const [isSimulating, setIsSimulating] = useState(false);
  const [hasResult, setHasResult] = useState(false);

  async function runSandbox() {
    if (selectedMerchant === '') {
      setPreviewBody('Please select a merchant (run warmup / push context first).');
      setPreviewDiagnostics('No contexts found.');
      setHasResult(false);
      return;
    }
    setIsSimulating(true);
    setHasResult(false);
    setPreviewBody('Simulating composition...');
    setPreviewDiagnostics('Running calculations...');
    try {
      const res = await fetch('/api/manual-sandbox-tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantIndex: parseInt(selectedMerchant, 10),
          triggerKind: selectedTrigger,
        }),
      });
      const result = await res.json();
      if (result.success && result.action) {
        setPreviewBody(result.action.body || 'No message sent.');
        setPreviewDiagnostics(
          JSON.stringify(
            {
              cta: result.action.cta,
              send_as: result.action.send_as,
              suppression_key: result.action.suppression_key,
              rationale: result.action.rationale,
            },
            null,
            2
          )
        );
        setHasResult(true);
      } else {
        setPreviewBody('Failed to generate message.');
        setPreviewDiagnostics(result.error || 'Unknown error occurred.');
      }
    } catch (err) {
      setPreviewBody('Connection error.');
      setPreviewDiagnostics(err.message);
    } finally {
      setIsSimulating(false);
    }
  }

  return (
    <>
      <div className="form-group">
        <label htmlFor="sandbox-merchant">Select Merchant</label>
        <select
          id="sandbox-merchant"
          className="styled-select"
          value={selectedMerchant}
          onChange={(e) => setSelectedMerchant(e.target.value)}
        >
          <option value="">
            {merchants.length === 0 ? 'No active merchants loaded (Run warmup first)' : 'Select a merchant...'}
          </option>
          {merchants.map((name, idx) => (
            <option key={idx} value={idx}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="sandbox-trigger">Select Trigger Type</label>
        <select
          id="sandbox-trigger"
          className="styled-select"
          value={selectedTrigger}
          onChange={(e) => setSelectedTrigger(e.target.value)}
        >
          {TRIGGER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <button className="glow-button" onClick={runSandbox} disabled={isSimulating}>
        {isSimulating ? <Loader2 size={16} strokeWidth={2.4} className="spin" /> : <MessageSquare size={16} strokeWidth={2.4} />}
        {isSimulating ? 'Simulating…' : 'Simulate Composition'}
      </button>

      <div className="sandbox-result-area">
        <h3>Output Message Preview</h3>
        <div className="preview-box">{previewBody}</div>
        {hasResult && <QualityBadges body={previewBody} />}

        <h3>Rationale &amp; Diagnostics</h3>
        <div className="preview-box code-style">{previewDiagnostics}</div>
      </div>
    </>
  );
}

function MetricCard({ label, value, icon: Icon, accent }) {
  return (
    <div className="metric-card" style={{ '--accent': accent }}>
      <div className="metric-icon-wrap">{Icon && <Icon size={20} strokeWidth={2} />}</div>
      <div className="metric-text">
        <div className="metric-val">{value}</div>
        <div className="metric-label">{label}</div>
      </div>
    </div>
  );
}

function LogEntry({ log }) {
  const ts = new Date(log.timestamp).toLocaleTimeString();
  let text = `[${ts}] ${log.message}`;
  if (log.details) {
    text += `\n${typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : log.details}`;
  }
  return <div className={`log-entry ${log.type}`}>{text}</div>;
}
