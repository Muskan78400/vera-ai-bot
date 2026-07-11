import { useState } from 'react';
import { Wand2, PlayCircle, Loader2 } from 'lucide-react';
import QualityBadges from './QualityBadges.jsx';

const TEMPLATE = JSON.stringify(
  {
    kind: 'perf_dip',
    scope: 'merchant',
    payload: {
      metric: 'calls',
      delta_pct: -0.35,
      window: '7d',
      vs_baseline: 20,
    },
    urgency: 3,
  },
  null,
  2
);

export default function TriggerBuilder({ merchants }) {
  const [selectedMerchant, setSelectedMerchant] = useState('');
  const [jsonText, setJsonText] = useState(TEMPLATE);
  const [jsonError, setJsonError] = useState('');
  const [previewBody, setPreviewBody] = useState('Write a trigger and click Compose to see the result.');
  const [previewDiagnostics, setPreviewDiagnostics] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [hasResult, setHasResult] = useState(false);

  function validateJson(text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed.kind) {
        setJsonError('Missing required field: "kind"');
        return null;
      }
      setJsonError('');
      return parsed;
    } catch (e) {
      setJsonError(`Invalid JSON: ${e.message}`);
      return null;
    }
  }

  async function handleCompose() {
    const parsed = validateJson(jsonText);
    if (!parsed) return;
    if (selectedMerchant === '') {
      setPreviewBody('Please select a merchant first.');
      return;
    }

    setIsComposing(true);
    setHasResult(false);
    setPreviewBody('Composing…');
    setPreviewDiagnostics('');
    try {
      const res = await fetch('/api/manual-custom-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantIndex: parseInt(selectedMerchant, 10),
          customTrigger: parsed,
        }),
      });
      const result = await res.json();
      if (result.success && result.action) {
        setPreviewBody(result.action.body || 'No message produced.');
        setPreviewDiagnostics(
          JSON.stringify(
            {
              cta: result.action.cta,
              send_as: result.action.send_as,
              suppression_key: result.action.suppression_key,
              rationale: result.action.rationale,
              resolved_trigger: result.resolvedTrigger,
            },
            null,
            2
          )
        );
        setHasResult(true);
      } else {
        setPreviewBody('Failed to compose.');
        setPreviewDiagnostics(result.error || 'Unknown error.');
      }
    } catch (err) {
      setPreviewBody('Connection error.');
      setPreviewDiagnostics(err.message);
    } finally {
      setIsComposing(false);
    }
  }

  return (
    <div className="panel glass-card flex-col">
      <div className="panel-header">
        <h2>
          <Wand2 size={18} strokeWidth={2.2} />
          Trigger Builder
        </h2>
        <span className="panel-subtitle">Compose against custom trigger JSON</span>
      </div>
      <div className="panel-body debugger-area">
        <div className="form-group">
          <label htmlFor="tb-merchant">Select Merchant</label>
          <select
            id="tb-merchant"
            className="styled-select"
            value={selectedMerchant}
            onChange={(e) => setSelectedMerchant(e.target.value)}
          >
            <option value="">
              {merchants.length === 0 ? 'No active merchants loaded' : 'Select a merchant...'}
            </option>
            {merchants.map((name, idx) => (
              <option key={idx} value={idx}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="tb-json">Trigger JSON</label>
          <textarea
            id="tb-json"
            className="styled-textarea"
            rows={12}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              validateJson(e.target.value);
            }}
            spellCheck={false}
          />
          {jsonError && <div className="json-error">{jsonError}</div>}
        </div>

        <button className="glow-button" onClick={handleCompose} disabled={isComposing || !!jsonError}>
          {isComposing ? <Loader2 size={16} strokeWidth={2.4} className="spin" /> : <PlayCircle size={16} strokeWidth={2.4} />}
          {isComposing ? 'Composing…' : 'Compose'}
        </button>

        <div className="sandbox-result-area">
          <h3>Output Message Preview</h3>
          <div className="preview-box">{previewBody}</div>
          {hasResult && <QualityBadges body={previewBody} />}

          {previewDiagnostics && (
            <>
              <h3>Rationale &amp; Diagnostics</h3>
              <div className="preview-box code-style">{previewDiagnostics}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
