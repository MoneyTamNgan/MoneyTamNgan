import { expect, it } from 'vitest';
import User from '@/models/User';
it('adds empty defaults for old users without requiring a migration', async () => {
    const user = new User({ email: 'fixture@example.test' });
    await expect(user.validate()).resolves.toBeUndefined();
    expect(user.registration_number).toBe(''); expect(user.address).toBe('');
    expect(user.authorized_signatory).toBe(''); expect(user.past_projects).toHaveLength(0);
});
it('enforces bid history bounds at the model layer', async () => {
    const project = { name: 'Work', client: 'Agency', value: 0, year: 2569 };
    const user = new User({ email: 'fixture@example.test', past_projects: [project] });
    await expect(user.validate()).resolves.toBeUndefined();
    user.past_projects[0].value = -1;
    await expect(user.validate()).rejects.toThrow();
    user.past_projects = Array(51).fill(project);
    await expect(user.validate()).rejects.toThrow();
});
