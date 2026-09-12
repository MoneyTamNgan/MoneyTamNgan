import connectDB from '@/lib/db';
import Keyword from '@/models/Keyword';
import { seedKeywordsIfEmpty } from '@/lib/keywords';
import { NextResponse } from 'next/server';

// TODO(auth): restrict to admin once the auth branch lands (all /admin/* paths,
// see securityScheme `mtn_session` in docs/api/openapi.yaml).

const CATEGORIES = ['software', 'non-software'];

function toApiShape(doc) {
    return {
        id: String(doc._id),
        keyword: doc.keyword,
        category: doc.category,
        updatedBy: doc.updated_by ?? null,
        updatedAt: doc.updated_at,
    };
}

function errorResponse(code, message, status) {
    return NextResponse.json({ error: { code, message } }, { status });
}

/** GET /api/admin/keywords — list every classification keyword rule. */
export async function GET() {
    try {
        await connectDB();
        await seedKeywordsIfEmpty();
        const items = await Keyword.find().sort({ category: 1, keyword: 1 }).lean();
        return NextResponse.json(items.map(toApiShape));
    } catch (error) {
        return errorResponse('LIST_KEYWORDS_FAILED', error.message, 500);
    }
}

/**
 * PUT /api/admin/keywords — replace the whole keyword list.
 * Body: [{ keyword: string, category: 'software' | 'non-software' }]
 */
export async function PUT(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('INVALID_BODY', 'Request body must be a JSON array', 400);
    }

    if (!Array.isArray(body)) {
        return errorResponse('INVALID_BODY', 'Request body must be a JSON array', 400);
    }

    const cleaned = [];
    for (const row of body) {
        const keyword = String(row?.keyword ?? '').trim();
        const category = row?.category;
        if (!keyword) {
            return errorResponse('EMPTY_KEYWORD', 'keyword must not be an empty string', 400);
        }
        if (!CATEGORIES.includes(category)) {
            return errorResponse(
                'BAD_CATEGORY',
                `category must be one of: ${CATEGORIES.join(', ')}`,
                400
            );
        }
        cleaned.push({ keyword, category });
    }

    // Drop duplicate (keyword, category) pairs, keeping the first occurrence.
    const seen = new Set();
    const unique = [];
    for (const row of cleaned) {
        const key = `${row.category}::${row.keyword.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(row);
    }

    try {
        await connectDB();
        // Not a transaction: acceptable at this scale. A failed insertMany leaves
        // the list empty until the next successful PUT.
        await Keyword.deleteMany({});
        if (unique.length > 0) {
            await Keyword.insertMany(unique);
        }
        const items = await Keyword.find().sort({ category: 1, keyword: 1 }).lean();
        return NextResponse.json(items.map(toApiShape));
    } catch (error) {
        return errorResponse('REPLACE_KEYWORDS_FAILED', error.message, 500);
    }
}
