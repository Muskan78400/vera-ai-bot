/**
 * Context + conversation store.
 *
 * Backed by MongoDB (via Mongoose models) when a connection is available;
 * otherwise transparently falls back to an in-memory Map so local dev and
 * quick testing never requires standing up a database first.
 *
 * All methods are async regardless of backend, so callers don't need to
 * know or care which mode is active.
 */
import { isMongoConnected } from './db.js';
import ContextModel from './models/Context.js';
import ConversationModel from './models/Conversation.js';

// ---- in-memory fallback state ----
const memContexts = new Map(); // `${scope}:${contextId}` -> { version, payload, updatedAt }
const memConversations = new Map(); // conversationId -> session object

class ContextStore {
  // ---------------- contexts ----------------

  async getContextCounts() {
    const counts = { category: 0, merchant: 0, customer: 0, trigger: 0 };
    if (isMongoConnected()) {
      const results = await ContextModel.aggregate([
        { $group: { _id: '$scope', count: { $sum: 1 } } },
      ]);
      for (const r of results) {
        if (counts[r._id] !== undefined) counts[r._id] = r.count;
      }
      return counts;
    }
    for (const key of memContexts.keys()) {
      const scope = key.split(':')[0];
      if (counts[scope] !== undefined) counts[scope]++;
    }
    return counts;
  }

  async getContext(scope, contextId) {
    if (isMongoConnected()) {
      const doc = await ContextModel.findOne({ scope, contextId }).lean();
      return doc ? doc.payload : null;
    }
    const entry = memContexts.get(`${scope}:${contextId}`);
    return entry ? entry.payload : null;
  }

  // Returns { accepted: boolean, reason?, currentVersion? }
  async setContext(scope, contextId, version, payload) {
    if (isMongoConnected()) {
      const existing = await ContextModel.findOne({ scope, contextId }).lean();
      if (existing && existing.version >= version) {
        return { accepted: false, reason: 'stale_version', currentVersion: existing.version };
      }
      await ContextModel.findOneAndUpdate(
        { scope, contextId },
        { scope, contextId, version, payload, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      return { accepted: true };
    }

    const key = `${scope}:${contextId}`;
    const existing = memContexts.get(key);
    if (existing && existing.version >= version) {
      return { accepted: false, reason: 'stale_version', currentVersion: existing.version };
    }
    memContexts.set(key, { version, payload, updatedAt: new Date().toISOString() });
    return { accepted: true };
  }

  async clear() {
    if (isMongoConnected()) {
      await ContextModel.deleteMany({});
      await ConversationModel.deleteMany({});
      return;
    }
    memContexts.clear();
    memConversations.clear();
  }

  // Helper used by dashboard API routes that need to enumerate all merchants/categories
  async listContexts(scope) {
    if (isMongoConnected()) {
      const docs = await ContextModel.find({ scope }).lean();
      return docs.map((d) => ({ contextId: d.contextId, payload: d.payload }));
    }
    const out = [];
    for (const [key, entry] of memContexts.entries()) {
      const [s, id] = key.split(':');
      if (s === scope) out.push({ contextId: id, payload: entry.payload });
    }
    return out;
  }

  // ---------------- conversations ----------------

  async getConversation(conversationId) {
    if (isMongoConnected()) {
      const doc = await ConversationModel.findOne({ conversationId }).lean();
      return doc || null;
    }
    return memConversations.get(conversationId) || null;
  }

  async createConversation(conversationId, merchantId, customerId, triggerId, sendAs) {
    const session = {
      conversationId,
      merchantId,
      customerId: customerId || null,
      triggerId,
      sendAs,
      state: 'active',
      waitSeconds: 0,
      updatedAt: new Date().toISOString(),
      messages: [],
      autoReplyCount: 0,
      lastMessageContent: null,
    };

    if (isMongoConnected()) {
      await ConversationModel.findOneAndUpdate(
        { conversationId },
        { $setOnInsert: session },
        { upsert: true }
      );
      return await ConversationModel.findOne({ conversationId }).lean();
    }

    memConversations.set(conversationId, session);
    return session;
  }

  async addMessage(conversationId, fromRole, body) {
    let session = await this.getConversation(conversationId);
    if (!session) {
      session = await this.createConversation(conversationId, null, null, null, 'vera');
    }

    const message = { role: fromRole, body, timestamp: new Date() };

    if (isMongoConnected()) {
      await ConversationModel.updateOne(
        { conversationId },
        { $push: { messages: message }, $set: { updatedAt: new Date() } }
      );
      return await ConversationModel.findOne({ conversationId }).lean();
    }

    session.messages.push({ ...message, timestamp: message.timestamp.toISOString() });
    session.updatedAt = new Date().toISOString();
    return session;
  }

  // Convenience for replier.js which mutates fields like autoReplyCount /
  // lastMessageContent / state directly on the session object it received.
  async saveConversation(session) {
    if (isMongoConnected()) {
      await ConversationModel.updateOne(
        { conversationId: session.conversationId },
        { $set: { ...session, updatedAt: new Date() } },
        { upsert: true }
      );
      return;
    }
    memConversations.set(session.conversationId, { ...session, updatedAt: new Date().toISOString() });
  }

  async getAllConversations() {
    if (isMongoConnected()) {
      return ConversationModel.find({}).lean();
    }
    return Array.from(memConversations.values());
  }
}

const store = new ContextStore();
export default store;
