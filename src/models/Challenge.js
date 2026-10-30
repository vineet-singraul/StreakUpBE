import mongoose from 'mongoose';

// A 30-day challenge: fixed rules (items) ticked once per day, starting from startDate (YYYY-MM-DD)
const challengeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    startDate: { type: String, required: true },
    days: { type: Number, default: 30 },
    active: { type: Boolean, default: true },
    endedAt: String, // YYYY-MM-DD when it was ended early or replaced
    items: [
      {
        name: { type: String, required: true, trim: true, maxlength: 80 },
        doneDays: { type: [Number], default: [] }, // 1..30
      },
    ],
  },
  { timestamps: true },
);

export default mongoose.model('Challenge', challengeSchema);
