const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    // select:false → never returned by default on any query, must be
    // explicitly requested with .select('+password') during login.
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin'], default: 'admin' },
    // Bumped on password change / "log out everywhere" — any JWT issued
    // before the bump (access or refresh) is rejected even if unexpired.
    tokenVersion: { type: Number, default: 0, select: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isLocked = function isLocked() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.registerFailedLogin = async function registerFailedLogin() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.failedLoginAttempts = 0;
    this.lockUntil = undefined;
  }
  this.failedLoginAttempts += 1;
  if (this.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    this.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
  }
  await this.save();
};

userSchema.methods.registerSuccessfulLogin = async function registerSuccessfulLogin() {
  this.failedLoginAttempts = 0;
  this.lockUntil = undefined;
  await this.save();
};

module.exports = mongoose.model('User', userSchema);
