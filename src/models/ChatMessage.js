import mongoose from 'mongoose';

// One document per question + answer exchange with the AI chatbot (visible to admins)
const chatMessageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    question: { type: String, required: true, maxlength: 500 },
    answer: { type: String, default: '' },
    query: { type: mongoose.Schema.Types.Mixed, default: null }, // the DB query Gemini generated
    resultCount: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

chatMessageSchema.index({ user: 1, createdAt: -1 });
chatMessageSchema.index({ createdAt: -1 });
// Free MongoDB is 512 MB: keep chat history for CHAT_RETENTION_DAYS (default 90)
chatMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: (Number(process.env.CHAT_RETENTION_DAYS) || 90) * 24 * 3600 });

export default mongoose.model('ChatMessage', chatMessageSchema);
