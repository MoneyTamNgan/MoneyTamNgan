import dns from 'node:dns';

const DEFAULT_DNS_FALLBACK = ['8.8.8.8', '1.1.1.1'];

export function isMongoSrvDnsError(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = error?.message || '';
    const transientDnsCodes = new Set([
        'EBADRESP', 'ECONNREFUSED', 'ETIMEOUT', 'EAI_AGAIN', 'ESERVFAIL',
    ]);
    return code === 'EBADRESP'
        || (transientDnsCodes.has(code)
            && /(?:querySrv|queryTxt|_mongodb\._tcp)/i.test(message));
}
export function configuredMongoDnsServers() {
    const configured = process.env.MONGODB_DNS_SERVERS
        ?.split(',')
        .map(value => value.trim())
        .filter(Boolean);
    return configured?.length ? configured : DEFAULT_DNS_FALLBACK;
}

export function mongoConnectionOptions() {
    return {
        bufferCommands: false,
        // The existing Atlas URI has no path, so make the application database
        // explicit instead of silently writing to MongoDB's default `test` DB.
        dbName: process.env.MONGODB_DB_NAME || 'moneytamngan',
    };
}

/**
 * Connect normally first. Some macOS/Node resolver combinations return a
 * malformed SRV response even though public DNS resolves Atlas correctly; in
 * that specific case retry once using configurable public resolvers.
 */
export async function connectMongoWithDnsFallback(mongoose, uri) {
    try {
        return await mongoose.connect(uri, mongoConnectionOptions());
    } catch (error) {
        if (!isMongoSrvDnsError(error) || !String(uri).startsWith('mongodb+srv://')) {
            throw error;
        }

        const servers = configuredMongoDnsServers();
        console.warn(`MongoDB SRV lookup failed; retrying with DNS servers: ${servers.join(', ')}`);
        dns.setServers(servers);
        return mongoose.connect(uri, mongoConnectionOptions());
    }
}
