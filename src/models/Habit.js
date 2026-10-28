import mongoose from 'mongoose';

// A habit lives inside one month; each tick is a YYYY-MM-DD string in completedDates
const habitSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    month: { type: String, required: true }, // YYYY-MM
    name: { type: String, required: true, trim: true, maxlength: 100 },
    completedDates: { type: [String], default: [] },
  },
  { timestamps: true },
);

habitSchema.index({ user: 1, month: 1 });

export default mongoose.model('Habit', habitSchema);
