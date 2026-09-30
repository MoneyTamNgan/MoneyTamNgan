import mongoose, { Schema, model, models } from 'mongoose';

const UserSchema = new Schema({
    email: { type: String, required: true, unique: true },
    name: String,
    googleId: String,
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
    match_score_threshold: { type: Number, default: 70 },
    updatedAt: { type: Date, default: Date.now },
});

export const User = models.User || model('User', UserSchema);