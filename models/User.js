import mongoose from 'mongoose';
import { USERNAME_MIN, USERNAME_MAX, USERNAME_PATTERN } from '../lib/username.js';

const { Schema, model, models } = mongoose;

const UserSchema = new Schema({
    email: { type: String, required: true, unique: true },
    name: String,
    // Optional so Google-only accounts keep working; filled by `npm run db:migrate-users`.
    username: {
        type: String,
        trim: true,
        lowercase: true,
        minlength: USERNAME_MIN,
        maxlength: USERNAME_MAX,
        match: USERNAME_PATTERN,
    },
    googleId: String,
    passwordHash: { type: String, select: false },
    picture: String,
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    techStack: { type: [String], default: [] },
    company_name: { type: String, default: '' },
    skills: { type: [String], default: [] },
    registered_capital: { type: Number, default: null },
    highest_past_project_value: { type: Number, default: null },
    concurrent_project_capacity: { type: Number, default: null },
    certifications: { type: [String], default: [] },
    email_notifications_enabled: { type: Boolean, default: false },
    match_score_threshold: { type: Number, default: 70, min: 0, max: 100 },
    notification_frequency: {
        type: String,
        enum: ['IMMEDIATE', 'DAILY_DIGEST'],
        default: 'IMMEDIATE',
    },
    updatedAt: { type: Date, default: Date.now },
});
// Unique only when a username is set, so users without one do not collide on null.
UserSchema.index(
    { username: 1 },
    { unique: true, name: 'uniq_user_username', partialFilterExpression: { username: { $type: 'string' } } },
);
// Defense in depth for document serialization; lean queries still rely on
// select:false and explicit public response fields.
for (const option of ['toJSON', 'toObject']) UserSchema.set(option, {
    transform(_doc, value) { delete value.passwordHash; return value; },
});
export const User = models.User || model('User', UserSchema);
export default User;
