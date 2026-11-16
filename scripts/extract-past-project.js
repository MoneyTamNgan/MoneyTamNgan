import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { enrichPastProjectForProject, initializePastProjectFields } from '../lib/vertex/past-project-qualifications.js';

async function main() {
    const target = process.argv[2]?.trim();
    if (!target) throw new Error('Usage: npm run vertex:past-project -- <PROJECT_ID> or --initialize');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const result = target === '--initialize' ? await initializePastProjectFields() : await enrichPastProjectForProject(target);
    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect().catch(() => {}));
