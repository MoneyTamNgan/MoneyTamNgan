import mongoose, { Schema, model, models } from 'mongoose';

const UserSchema = new Schema({
    email: { type: String, required: true, unique: true },
    name: String,
    googleId: String,
    picture: String,
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    techStack: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now },
});

export const User = models.User || model('User', UserSchema);