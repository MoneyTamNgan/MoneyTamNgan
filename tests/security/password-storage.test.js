import { expect, it } from 'vitest';
import { User } from '@/models/User';

it('excludes password hashes by default and removes them from document serialization', () => {
    expect(User.schema.path('passwordHash').options.select).toBe(false);
    const user = new User({ email: 'hash-fixture@example.com', passwordHash: 'private-hash' });
    expect(user.passwordHash).toBe('private-hash');
    expect(user.toJSON().passwordHash).toBeUndefined();
    expect(user.toObject().passwordHash).toBeUndefined();
});
