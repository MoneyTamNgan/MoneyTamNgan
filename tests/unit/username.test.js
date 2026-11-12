import { describe, expect, it } from 'vitest';
import { normalizeUsername, deriveUsername, planUsernameBackfill } from '@/lib/username';
import { User } from '@/models/User';

describe('normalizeUsername', () => {
    it('trims and lowercases valid names', () => {
        expect(normalizeUsername('  Napat.S_1 ')).toBe('napat.s_1');
    });
    it.each(['ab', 'a'.repeat(31), '.start', 'end-', 'has space', 'ไทย', 'admin', 'Root', 42, null, undefined])(
        'rejects %p', value => expect(normalizeUsername(value)).toBeNull());
});

describe('deriveUsername', () => {
    it('uses a sanitized email local part', () => {
        expect(deriveUsername('Peerawat.Thee+test@example.com')).toBe('peerawat.thee-test');
    });
    it('pads short or empty local parts and avoids reserved names', () => {
        expect(normalizeUsername(deriveUsername('a@example.com'))).not.toBeNull();
        expect(deriveUsername('admin@example.com')).toBe('admin-2');
        expect(normalizeUsername(deriveUsername('@@@'))).not.toBeNull();
    });
    it('appends a counter on collision and stays within 30 characters', () => {
        expect(deriveUsername('sam@example.com', new Set(['sam', 'sam-2']))).toBe('sam-3');
        const long = deriveUsername(`${'x'.repeat(60)}@example.com`, new Set(['x'.repeat(25)]));
        expect(long.length).toBeLessThanOrEqual(30);
        expect(normalizeUsername(long)).toBe(long);
    });
});

describe('planUsernameBackfill', () => {
    it('only fills missing usernames, never reuses or changes existing ones', () => {
        const plan = planUsernameBackfill([
            { _id: 1, email: 'a@x.com', username: 'taken' },
            { _id: 2, email: 'taken@x.com' },
            { _id: 3, email: 'taken@y.com', username: '' },
            { _id: 4, email: 'new@x.com' },
        ]);
        expect(plan).toEqual([
            { id: 2, username: 'taken-2' },
            { id: 3, username: 'taken-3' },
            { id: 4, username: 'new' },
        ]);
    });
    it('is idempotent once applied', () => {
        const users = [{ _id: 1, email: 'a@x.com' }, { _id: 2, email: 'a@y.com' }];
        const applied = users.map(u => ({ ...u, username: planUsernameBackfill(users).find(p => p.id === u._id).username }));
        expect(planUsernameBackfill(applied)).toEqual([]);
    });
});

describe('User schema', () => {
    it('declares username, a partial unique index, and never exposes the hash', async () => {
        expect(User.schema.path('username')).toBeDefined();
        const index = User.schema.indexes().find(([fields]) => fields.username === 1);
        expect(index[1]).toMatchObject({ unique: true, partialFilterExpression: { username: { $type: 'string' } } });
        const doc = new User({ email: 'a@x.com', username: 'Valid_Name', passwordHash: 'secret' });
        expect(doc.username).toBe('valid_name');
        expect(doc.toJSON().passwordHash).toBeUndefined();
        await expect(new User({ email: 'a@x.com', username: 'x' }).validate()).rejects.toThrow(/username/);
        await expect(new User({ email: 'a@x.com' }).validate()).resolves.toBeUndefined();
    });
});
