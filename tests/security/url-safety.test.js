import { describe, expect, it } from 'vitest';
import {
    isPrivateIp,
    resolveAndValidateRemoteDocumentUrl,
    validateRemoteDocumentUrl,
} from '@/lib/url-safety';

describe('URL safety / SSRF protection (TH-10)', () => {
    it('allows valid public HTTPS document URLs', () => {
        expect(validateRemoteDocumentUrl('https://process5.gprocurement.go.th/tor/file.pdf'))
            .toBe('https://process5.gprocurement.go.th/tor/file.pdf');
        expect(validateRemoteDocumentUrl('https://8.8.8.8/public.pdf'))
            .toBe('https://8.8.8.8/public.pdf');
    });

    it('rejects non-HTTP(S) schemes and embedded credentials', () => {
        for (const bad of [
            'file:///etc/passwd',
            'ftp://example.go.th/tor.pdf',
            'javascript:alert(1)',
            'https://user:pass@example.go.th/tor.pdf',
        ]) {
            expect(() => validateRemoteDocumentUrl(bad)).toThrow();
        }
    });

    it('rejects localhost, internal domain suffixes, and single-label hosts', () => {
        for (const bad of [
            'http://localhost/admin',
            'https://sub.localhost/secret',
            'http://metadata.local/latest',
            'http://service.internal/config',
            'http://redis:6379/',
        ]) {
            expect(() => validateRemoteDocumentUrl(bad), bad).toThrow(/local or private/);
        }
    });

    it('rejects private IPv4 ranges including 0.0.0.0/8, CGNAT, and link-local', () => {
        for (const ip of [
            '0.0.0.0',
            '127.0.0.1',
            '127.0.1.1',
            '10.0.0.1',
            '172.16.0.1',
            '172.31.255.254',
            '192.168.1.10',
            '169.254.169.254',
            '100.64.0.1',
            '100.127.255.254',
            '224.0.0.1',
        ]) {
            expect(isPrivateIp(ip), ip).toBe(true);
            expect(() => validateRemoteDocumentUrl(`http://${ip}/tor.pdf`), ip).toThrow(/local or private/);
        }
    });

    it('rejects bracketed IPv6 loopback, unspecified, ULA, link-local, and IPv4-mapped addresses', () => {
        for (const bad of [
            'http://[::1]/secret.pdf',
            'http://[::1]:3000/api/health',
            'http://[::]/secret.pdf',
            'http://[::ffff:127.0.0.1]/secret.pdf',
            'http://[::ffff:7f00:1]/secret.pdf',
            'http://[fc00::1]/secret.pdf',
            'http://[fd12:3456:789a::1]/secret.pdf',
            'http://[fe80::1]/secret.pdf',
        ]) {
            expect(() => validateRemoteDocumentUrl(bad), bad).toThrow(/local or private/);
        }
    });

    it('validates DNS resolution results in resolveAndValidateRemoteDocumentUrl', async () => {
        await expect(
            resolveAndValidateRemoteDocumentUrl('https://egp.example.go.th/tor.pdf', async () => [
                { address: '203.0.113.10', family: 4 },
            ])
        ).resolves.toBe('https://egp.example.go.th/tor.pdf');

        await expect(
            resolveAndValidateRemoteDocumentUrl('https://rebind.example.com/tor.pdf', async () => [
                { address: '127.0.0.1', family: 4 },
            ])
        ).rejects.toThrow(/local or private/);

        await expect(
            resolveAndValidateRemoteDocumentUrl('https://rebind6.example.com/tor.pdf', async () => [
                { address: '::1', family: 6 },
            ])
        ).rejects.toThrow(/local or private/);

        await expect(
            resolveAndValidateRemoteDocumentUrl('https://empty-dns.example.com/tor.pdf', async () => [])
        ).rejects.toThrow(/local or private/);
    });
});

