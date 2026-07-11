import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    role: String, // 'vera' | 'merchant_on_behalf' | 'merchant' | 'customer'
    body: String,
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, unique: true },
    merchantId: String,
    customerId: String,
    triggerId: String,
    sendAs: String,
    state: { type: String, default: 'active' }, // 'active' | 'waiting' | 'ended'
    waitSeconds: { type: Number, default: 0 },
    messages: { type: [messageSchema], default: [] },
    autoReplyCount: { type: Number, default: 0 },
    lastMessageContent: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'conversations' }
);

export default mongoose.model('Conversation', conversationSchema);
