"""Print embedded PDF text as JSON {path: text}; one extractor for every pipeline."""

import json
import sys

import pypdf

out = {}
for path in sys.argv[1:]:
    try:
        reader = pypdf.PdfReader(path)
        out[path] = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as error:  # unreadable/encrypted PDFs count as no text
        out[path] = ""
        print(f"{path}: {error}", file=sys.stderr)
print(json.dumps(out, ensure_ascii=False))
