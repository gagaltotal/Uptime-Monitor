const mongoose = require('mongoose');

const statusPageSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]{3,80}$/, 'Slug hanya boleh huruf kecil, angka, dan tanda hubung'],
    },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    isPublished: { type: Boolean, default: true },
    monitors: [
      {
        _id: false,
        monitor: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
        // Optional public-facing label, e.g. show "API" instead of the real hostname.
        displayName: { type: String, trim: true, maxlength: 150 },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StatusPage', statusPageSchema);
