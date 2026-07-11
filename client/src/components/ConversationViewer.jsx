import { useEffect, useState, useCallback } from 'react';
import { MessagesSquare, Loader2 } from 'lucide-react';

export default function ConversationViewer() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      setConversations(data || []);
    } catch {
      // silent — conversation list is non-critical background refresh
    }
  }, []);

  useEffect(() => {
    refreshList();
    const timer = setInterval(refreshList, 3000);
    return () => clearInterval(timer);
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/conversations/${encodeURIComponent(selectedId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="panel glass-card flex-col conversation-viewer">
      <div className="panel-header">
        <h2>
          <MessagesSquare size={18} strokeWidth={2.2} />
          Conversation Viewer
        </h2>
        <span className="panel-subtitle">Turn-by-turn thread, not raw logs</span>
      </div>
      <div className="panel-body debugger-area">
        <div className="form-group">
          <label htmlFor="convo-select">Select Conversation</label>
          <select
            id="convo-select"
            className="styled-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">
              {conversations.length === 0 ? 'No conversations yet — run a tick first' : 'Select a conversation...'}
            </option>
            {conversations.map((c) => (
              <option key={c.conversationId} value={c.conversationId}>
                {c.conversationId} ({(c.messages || []).length} turns, {c.state})
              </option>
            ))}
          </select>
        </div>

        <div className="chat-thread">
          {loading && (
            <div className="placeholder-text loading-row">
              <Loader2 size={14} strokeWidth={2.4} className="spin" /> Loading…
            </div>
          )}
          {!loading && !detail && (
            <div className="placeholder-text">Select a conversation above to see its full thread.</div>
          )}
          {!loading &&
            detail &&
            (detail.messages || []).map((m, i) => (
              <ChatBubble key={i} role={m.role} body={m.body} timestamp={m.timestamp} />
            ))}
          {!loading && detail && (detail.messages || []).length === 0 && (
            <div className="placeholder-text">This conversation has no messages yet.</div>
          )}
        </div>

        {detail && (
          <div className="convo-meta">
            <span>
              State: <strong>{detail.state}</strong>
            </span>
            <span>
              Auto-reply count: <strong>{detail.autoReplyCount ?? 0}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatBubble({ role, body, timestamp }) {
  const isMerchantOrCustomer = role === 'merchant' || role === 'customer';
  const ts = timestamp ? new Date(timestamp).toLocaleTimeString() : '';
  const initial = (role || '?').charAt(0).toUpperCase();
  return (
    <div className={`chat-bubble-row ${isMerchantOrCustomer ? 'incoming' : 'outgoing'}`}>
      {isMerchantOrCustomer && <div className="chat-avatar">{initial}</div>}
      <div className="chat-bubble">
        <div className="chat-bubble-role">{role}</div>
        <div className="chat-bubble-body">{body}</div>
        {ts && <div className="chat-bubble-ts">{ts}</div>}
      </div>
      {!isMerchantOrCustomer && <div className="chat-avatar outgoing-avatar">{initial}</div>}
    </div>
  );
}
