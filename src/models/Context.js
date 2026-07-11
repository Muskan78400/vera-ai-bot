import mongoose from 'mongoose';

const contextSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, enum: ['category', 'merchant', 'customer', 'trigger'] },
    contextId: { type: String, required: true },
    version: { type: Number, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'contexts' }
);

// Compound unique key: one document per (scope, contextId)
contextSchema.index({ scope: 1, contextId: 1 }, { unique: true });

export default mongoose.model('Context', contextSchema);
