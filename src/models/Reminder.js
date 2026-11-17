import mongoose from 'mongoose';

export const TONES = ['chime', 'bell', 'digital', 'soft', 'song', 'voice'];

// A one-time reminder at an exact moment. The custom song / voice recording itself is kept on the
// user's device (IndexedDB), never on the server, so the free 512 MB database stays small.
const reminderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    at: { type: Date, required: true },
    tone: { type: String, enum: TONES, default: 'chime' },
    speak: { type: Boolean, default: true }, // read the title aloud (text-to-speech)
    sent: { type: Boolean, default: false }, // push already sent by the scheduler
  },
  { timestamps: true },
);

// The every-minute scheduler looks up "not sent and due"
reminderSchema.index({ sent: 1, at: 1 });

export default mongoose.model('Reminder', reminderSchema);
