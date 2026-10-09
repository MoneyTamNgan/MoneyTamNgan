"""
Team Playwright TOR scraper (pipeline P2 in the benchmark).

Document-download logic is kept as written by the team. Benchmark-only
changes are marked "BENCH:":
  - --ids <json> runs a fixed project list instead of crawling the IT category
  - --work-dir / --out make download and output locations configurable
  - each result records ms, error and extracted_files so the harness can
    judge success with the same rules as the other pipelines
"""

import argparse
import asyncio
import json
import os
import re
import time
import zipfile
from playwright.async_api import async_playwright

# --- CONFIGURATION ---
CATEGORY_URL = "https://egp-gprocurement.com/industry/information-technology"
DOWNLOAD_DIR = "./downloads"
EXTRACT_DIR = "./extracted_docs"
OUTPUT_JSON = "./egp_scraped_results.json"
THAI_DIGITS_TRANS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")

# ------------------------------------------------------------------
# ZIP EXTRACTION & FILE CLASSIFICATION
# ------------------------------------------------------------------

# Keywords that identify a TOR document (checked against lowercase filename)
_TOR_KEYWORDS = [
    "tor",           # plain TOR, Attach_TOR_1, TOR_v2, …
    "ขอบเขต",        # ขอบเขตของงาน
    "คุณลักษณะ",     # คุณลักษณะเฉพาะ
    "รายละเอียด",    # รายละเอียดงาน
    "spec",          # spec / specification
    "scope",         # scope of work
    "requirement",   # requirements
    "terms_of_ref",  # terms_of_reference
]

# Keywords that identify an Announcement document
_ANNOUNCEMENT_KEYWORDS = [
    "annou",
    "ประกาศ",
    "invite",
    "เชิญชวน",
    "ประกวด",
]


def _is_tor_file(fname: str) -> bool:
    """Return True if the filename strongly suggests a TOR document."""
    fl = fname.lower()
    return any(kw in fl for kw in _TOR_KEYWORDS)


def _is_announcement_file(fname: str) -> bool:
    """Return True if the filename strongly suggests an Announcement document."""
    fl = fname.lower()
    return any(kw in fl for kw in _ANNOUNCEMENT_KEYWORDS)


def process_downloaded_zip(zip_path: str, project_id: str) -> dict:
    """Unzips project archive and classifies TOR vs Announcement PDF paths.

    Returns a dict with:
      tor_doc          – path to the primary TOR file (first/largest match), or None
      tor_docs         – list of ALL matched TOR file paths (supports Attach_TOR_1, _2 …)
      announcement_doc – path to announcement file, or None
      extracted_files  – list of all extracted file paths
    """
    res = {
        "tor_doc": None,
        "tor_docs": [],
        "announcement_doc": None,
        "extracted_files": [],
    }

    if not zip_path or not os.path.exists(zip_path):
        return res

    project_extract_path = os.path.join(EXTRACT_DIR, project_id)
    os.makedirs(project_extract_path, exist_ok=True)

    try:
        if zipfile.is_zipfile(zip_path):
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(project_extract_path)

            # Walk recursively so nested sub-folders are also covered
            for root, _dirs, files in os.walk(project_extract_path):
                for fname in sorted(files):  # sorted → deterministic order
                    full_file_path = os.path.join(root, fname)
                    res["extracted_files"].append(full_file_path)

                    if _is_tor_file(fname):
                        res["tor_docs"].append(full_file_path)
                        print(f"    [+] Found TOR Document: {fname}")
                    elif _is_announcement_file(fname):
                        if res["announcement_doc"] is None:
                            res["announcement_doc"] = full_file_path
                        print(f"    [+] Found Announcement Document: {fname}")

            # Primary tor_doc: prefer the one whose name starts with "tor"
            # among all matches; otherwise take the first found.
            if res["tor_docs"]:
                preferred = [
                    p for p in res["tor_docs"]
                    if os.path.basename(p).lower().startswith("tor")
                ]
                res["tor_doc"] = preferred[0] if preferred else res["tor_docs"][0]

            # Fallback: if still no TOR found, pick the largest PDF in the archive
            # (most likely the substantive document)
            if not res["tor_doc"]:
                pdf_candidates = [
                    p for p in res["extracted_files"]
                    if p.lower().endswith(".pdf")
                    and p not in (res["announcement_doc"] or [])
                ]
                if pdf_candidates:
                    largest_pdf = max(pdf_candidates, key=os.path.getsize)
                    res["tor_doc"] = largest_pdf
                    res["tor_docs"].append(largest_pdf)
                    print(
                        f"    [~] No TOR keyword match; using largest PDF as fallback: "
                        f"{os.path.basename(largest_pdf)}"
                    )

        else:
            # Single file (PDF / other) — treat as TOR directly
            res["tor_doc"] = zip_path
            res["tor_docs"].append(zip_path)
            res["extracted_files"].append(zip_path)
            print(f"    [+] Single-file package treated as TOR: {os.path.basename(zip_path)}")

    except Exception as e:
        print(f"    [!] Error unzipping package {zip_path}: {e}")

    return res


# ------------------------------------------------------------------
# HELPER FUNCTIONS: Schedule & PDF Text Parsing
# ------------------------------------------------------------------
def extract_submission_schedule(text: str) -> dict:
    """Parses Thai submission schedule text using regex."""
    if not text:
        return {}

    clean_text = text.translate(THAI_DIGITS_TRANS)
    pattern = re.compile(
        r"(?:ในวันที่|เสนอราคา.*ในวันที่)\s*([0-9]{1,2})\s+([ก-๙]+)\s+([0-9]{4})\s+ระหว่างเวลา\s+([0-9\.:]+)\s*น\.\s*ถึง\s*([0-9\.:]+)\s*น\.",
        re.IGNORECASE,
    )
    match = pattern.search(clean_text)
    if match:
        day, month, year, start_time, end_time = match.groups()
        return {
            "submission_date": f"{day} {month} {year}",
            "submission_start_time": start_time,
            "submission_closing_time": end_time,
            "full_schedule_text": f"{day} {month} {year} ({start_time} - {end_time})",
        }
    return {}


def parse_pdf_text(pdf_path: str) -> str:
    """Extracts text content from a PDF file."""
    if not pdf_path or not os.path.exists(pdf_path):
        return ""
    try:
        import pypdf

        reader = pypdf.PdfReader(pdf_path)
        return "\n".join(
            [page.extract_text() for page in reader.pages if page.extract_text()]
        )
    except Exception:
        try:
            import pdfplumber

            with pdfplumber.open(pdf_path) as pdf:
                return "\n".join(
                    [
                        page.extract_text()
                        for page in pdf.pages
                        if page.extract_text()
                    ]
                )
        except Exception:
            return ""


# ------------------------------------------------------------------
# STAGE 2: Interactive Modal & Popup Downloader
# ------------------------------------------------------------------
def _suppress_task_exceptions(*tasks) -> None:
    """Retrieve (and discard) stored exceptions from finished asyncio Tasks
    so Python does not emit 'Task exception was never retrieved' warnings."""
    for task in tasks:
        if task.done() and not task.cancelled():
            try:
                task.exception()   # marks exception as retrieved
            except Exception:
                pass


async def _fetch_zip_from_doc_review_url(
    page, review_url: str, project_id: str, attempt: int
) -> str | None:
    """
    Handle the egp-doc-review-web SPA redirect.

    The SPA URL looks like:
      https://process5.gprocurement.go.th/egp-doc-review-web/
        #targetproc=drvmere002&projectId=69099596354&itemNo=0&shortToken=<JWT>

    The SPA uses that shortToken as a Bearer token to call an internal API
    that serves the actual ZIP.  We:
      1. Extract projectId, itemNo, targetproc, and shortToken from the fragment.
      2. Try the known ZIP-bundle endpoint with Bearer auth.
      3. If that fails, wait for the SPA to load and intercept the first
         network request that returns a binary (zip/pdf) content-type.
    """
    import urllib.parse

    print(f"    [~] Detected egp-doc-review-web SPA — extracting params from URL fragment...")

    # Parse the fragment: everything after '#'
    fragment = review_url.split("#", 1)[1] if "#" in review_url else ""
    params = dict(urllib.parse.parse_qsl(fragment))

    short_token = params.get("shortToken", "")
    proc_project_id = params.get("projectId", project_id)
    item_no = params.get("itemNo", "0")
    target_proc = params.get("targetproc", "drvmere002")

    if not short_token:
        print("    [!] No shortToken found in doc-review URL — cannot authenticate.")
        return None

    print(f"    [~] shortToken found (length {len(short_token)}), projectId={proc_project_id}, itemNo={item_no}")

    # --- Attempt 1: call the known ZIP bundle endpoint directly ---
    # Pattern observed from working process5 download flows.
    zip_endpoints = [
        f"https://process5.gprocurement.go.th/egp-doc-publish-web/downloadZip"
        f"?projectId={proc_project_id}&itemNo={item_no}&targetProc={target_proc}",
        f"https://process5.gprocurement.go.th/egp2procmainWeb/getTORZip.sch"
        f"?projectId={proc_project_id}&itemNo={item_no}",
        f"https://process5.gprocurement.go.th/egp-agpc01-web/announcement/downloadFile"
        f"?projectId={proc_project_id}&itemNo={item_no}",
    ]

    auth_headers = {
        "Authorization": f"Bearer {short_token}",
        "Referer": "https://www.gprocurement.go.th/",
        "Origin": "https://process5.gprocurement.go.th",
    }

    for endpoint in zip_endpoints:
        try:
            response = await page.context.request.get(
                endpoint,
                headers=auth_headers,
                timeout=20000,
            )
            if response.ok:
                ctype = response.headers.get("content-type", "").lower()
                if "html" not in ctype and len(await response.body()) > 1000:
                    ext = ".zip" if "zip" in ctype else ".pdf"
                    fpath = os.path.join(DOWNLOAD_DIR, f"{project_id}_draft_tor{attempt}{ext}")
                    with open(fpath, "wb") as f:
                        f.write(await response.body())
                    print(f"    [+] Saved via doc-review ZIP endpoint: {fpath}")
                    return fpath
                else:
                    print(f"    [~] Endpoint returned HTML or empty body: {endpoint}")
            else:
                print(f"    [~] Endpoint {response.status}: {endpoint}")
        except Exception as e:
            print(f"    [~] Endpoint failed ({endpoint}): {e}")

    # --- Attempt 2: navigate to the SPA and intercept the binary XHR it fires ---
    # The SPA loads, then immediately fetches the document ZIP/PDF via XHR.
    # We intercept the first response with a binary content-type.
    print(f"    [~] Direct endpoints failed — loading SPA and intercepting XHR...")
    captured = {}

    async def intercept_response(response):
        if captured.get("done"):
            return
        ctype = response.headers.get("content-type", "").lower()
        if any(t in ctype for t in ("zip", "pdf", "octet-stream", "binary")) and response.ok:
            try:
                body = await response.body()
                if len(body) > 1000:
                    ext = ".zip" if "zip" in ctype else ".pdf"
                    fpath = os.path.join(DOWNLOAD_DIR, f"{project_id}_spa_intercept{attempt}{ext}")
                    with open(fpath, "wb") as f:
                        f.write(body)
                    captured["path"] = fpath
                    captured["done"] = True
                    print(f"    [+] Intercepted binary XHR from SPA: {fpath}")
            except Exception:
                pass

    page.on("response", intercept_response)
    try:
        await page.goto(review_url, wait_until="domcontentloaded", timeout=20000)
        # Give the SPA up to 15s to fire its download XHR
        for _ in range(30):
            if captured.get("done"):
                break
            await page.wait_for_timeout(500)
    except Exception as e:
        print(f"    [!] SPA load failed: {e}")
    finally:
        page.remove_listener("response", intercept_response)

    if captured.get("path"):
        return captured["path"]

    print(f"    [!] Could not extract file from doc-review SPA for project {project_id}.")
    return None


async def _try_download_from_btn(
    page, modal, download_btn, project_id: str, attempt: int,
    pre_href: str | None = None,
) -> str | None:
    """Clicks a download button and captures the resulting file-download event,
    popup tab, or page navigation. Returns local filepath or None.

    Args:
        pre_href: href value read BEFORE clicking (avoids stale-locator timeouts).
    """
    print(f"    [*] Triggering download/popup (attempt {attempt})...")

    original_url = page.url

    # Register all three event listeners BEFORE the click
    download_task = asyncio.create_task(
        page.wait_for_event("download", timeout=10000)
    )
    popup_task = asyncio.create_task(
        page.context.wait_for_event("page", timeout=10000)
    )
    nav_task = asyncio.create_task(
        page.wait_for_event("framenavigated", timeout=10000)
    )

    await download_btn.click(force=True)

    done, pending = await asyncio.wait(
        [download_task, popup_task, nav_task],
        timeout=13,
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()
    # Suppress "Task exception was never retrieved" for timed-out tasks
    _suppress_task_exceptions(*pending, *done)

    # ----------------------------------------------------------------
    # Case 1: Standard browser file download (.zip / attachment)
    # ----------------------------------------------------------------
    if download_task in done:
        try:
            download = download_task.result()
            suggested_fname = download.suggested_filename or "document.zip"
            filepath = os.path.join(
                DOWNLOAD_DIR, f"{project_id}_bundle_{suggested_fname}"
            )
            await download.save_as(filepath)
            print(f"    [+] Saved file download: {filepath}")
            return filepath
        except Exception as e:
            print(f"    [!] Download event failed: {e}")

    # ----------------------------------------------------------------
    # Case 2: New tab / popup (PDF viewer)
    # ----------------------------------------------------------------
    if popup_task in done:
        try:
            popup_page = popup_task.result()
            await popup_page.wait_for_load_state("domcontentloaded", timeout=15000)
            print(f"    [+] Popup tab opened: {popup_page.url}")

            pdf_url = popup_page.url
            for selector in ("embed[src]", "iframe[src]", "object[data]"):
                elem = await popup_page.query_selector(selector)
                if elem:
                    attr = "data" if selector.startswith("object") else "src"
                    src = await elem.get_attribute(attr, timeout=3000)
                    if src:
                        pdf_url = (
                            src if src.startswith("http")
                            else f"https://process5.gprocurement.go.th{src}"
                        )
                        break

            response = await page.context.request.get(pdf_url, timeout=20000)
            if response.ok:
                pdf_filepath = os.path.join(DOWNLOAD_DIR, f"{project_id}_draft_tor.pdf")
                with open(pdf_filepath, "wb") as f:
                    f.write(await response.body())
                print(f"    [+] Saved PDF from popup tab: {pdf_filepath}")
                await popup_page.close()
                return pdf_filepath
            await popup_page.close()
        except Exception as e:
            print(f"    [!] Popup handling failed: {e}")

    # ----------------------------------------------------------------
    # Case 3: Click navigated the CURRENT page (e.g. draft document links)
    # ----------------------------------------------------------------
    if nav_task in done:
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
            new_url = page.url
            if new_url != original_url and new_url not in ("about:blank", ""):
                print(f"    [+] Page navigated to: {new_url}")

                # --- Special case: egp-doc-review-web SPA ---
                # This viewer SPA encodes the real ZIP download params in the URL
                # fragment: #targetproc=...&projectId=...&itemNo=...&shortToken=...
                # We extract them and call the ZIP API directly.
                if "egp-doc-review-web" in new_url:
                    zip_path = await _fetch_zip_from_doc_review_url(
                        page, new_url, project_id, attempt
                    )
                    if zip_path:
                        # Restore original detail page for subsequent row attempts
                        try:
                            await page.goto(original_url, wait_until="domcontentloaded", timeout=10000)
                        except Exception:
                            pass
                        return zip_path
                    # Could not extract ZIP — restore page and fall through
                    try:
                        await page.goto(original_url, wait_until="domcontentloaded", timeout=10000)
                    except Exception:
                        pass
                    return None

                # Try to fetch as direct download (reject other HTML pages)
                response = await page.context.request.get(new_url, timeout=20000)
                if response.ok:
                    ctype = response.headers.get("content-type", "").lower()
                    if "html" in ctype:
                        print("    [~] Navigation target is HTML page (not direct download file). Returning to process5 detail page.")
                        try:
                            await page.goto(original_url, wait_until="domcontentloaded", timeout=10000)
                        except Exception:
                            pass
                        return None
                    else:
                        ext = ".pdf" if "pdf" in ctype else ".zip"
                        nav_path = os.path.join(
                            DOWNLOAD_DIR, f"{project_id}_nav{attempt}{ext}"
                        )
                        with open(nav_path, "wb") as f:
                            f.write(await response.body())
                        print(f"    [+] Saved from page navigation: {nav_path}")
                        return nav_path
        except Exception as e:
            print(f"    [!] Navigation handling failed: {e}")

    # ----------------------------------------------------------------
    # Case 4: Fallback — use pre-read href (avoids stale-locator hang)
    # ----------------------------------------------------------------
    if pre_href and pre_href not in ("#", "") and not pre_href.startswith("javascript"):
        full_href = (
            pre_href if pre_href.startswith("http")
            else f"https://process5.gprocurement.go.th{pre_href}"
        )
        try:
            response = await page.context.request.get(full_href, timeout=15000)
            if response.ok:
                ctype = response.headers.get("content-type", "").lower()
                if "html" not in ctype:
                    ext = ".pdf" if "pdf" in ctype else ".zip"
                    href_path = os.path.join(
                        DOWNLOAD_DIR, f"{project_id}_href{attempt}{ext}"
                    )
                    with open(href_path, "wb") as f:
                        f.write(await response.body())
                    print(f"    [+] Saved via href fallback: {href_path}")
                    return href_path
        except Exception as e:
            print(f"    [!] Href fallback failed: {e}")

    return None


async def _close_modal(modal, page, timeout: int = 600) -> None:
    """Attempt to close the modal gracefully, ignoring errors."""
    try:
        close_btn = modal.locator(
            "button[data-dismiss='modal'], .modal-header button.close, "
            "button:has-text('ปิด'), button:has-text('Close')"
        ).first
        if await close_btn.count() > 0:
            await close_btn.click(force=True)
            await page.wait_for_timeout(timeout)
    except Exception:
        pass


async def download_project_zip_bundle(page, project_id: str) -> str:
    """Waits for table rows, opens modal, and handles download vs popup tab events.

    Reliability improvements:
    - Tracks original page URL to detect unwanted navigations
    - Pre-reads all button hrefs while modal is stable (avoids 30 s stale-locator hang)
    - Retries up to MAX_ROW_ATTEMPTS rows on failure
    - Detects page-level navigation as a download signal (ร่างเอกสาร rows)
    - Properly suppresses 'Task exception was never retrieved' warnings
    """
    MAX_ROW_ATTEMPTS = 5

    # Wait for the table to appear — try progressively broader selectors.
    # Some process5 pages load the table late via JS, so we give it 45s total
    # and fall back to any visible link if the preferred table isn't found.
    table_found = False
    for selector, label in [
        ("table:has-text('ประกาศที่เกี่ยวข้อง') tbody tr td a", "preferred table"),
        ("table tbody tr td a", "any table row link"),
        ("table tbody tr", "any table row"),
        ("a[data-toggle='modal']", "any modal trigger"),
    ]:
        try:
            await page.wait_for_selector(selector, state="visible", timeout=45000)
            table_found = True
            break
        except Exception:
            print(f"    [~] Selector '{label}' not found, trying next...")

    if not table_found:
        print("    [-] Timeout waiting for table row action links on process5.")
        return None

    # Priority-ordered keywords for row selection
    priority_keywords = [
        "ประกาศเชิญชวน",
        "ร่างเอกสารประกวดราคา",
        "เอกสารประกวดราคา",
        "ประกวดราคา",
        "ประกาศราคากลาง",
    ]

    # Snapshot page URL before any interactions so we can detect navigations
    original_page_url = page.url

    # Target the primary document table if available, else fall back to page table
    doc_table = page.locator("table:has-text('ประกาศที่เกี่ยวข้อง')").first
    if await doc_table.count() == 0:
        doc_table = page

    # Build a ranked list of candidate rows: keyword-matched first, then all rows
    candidate_rows = []
    seen_indices: set[int] = set()
    all_rows = doc_table.locator("tbody tr")
    total_rows = await all_rows.count()

    for kw in priority_keywords:
        kw_rows = doc_table.locator("tbody tr").filter(has_text=kw)
        count = await kw_rows.count()
        for i in range(count):
            row = kw_rows.nth(i)
            try:
                bb = await row.bounding_box()
            except Exception:
                bb = None
            key = round(bb["y"]) if bb else id(row)
            if key not in seen_indices:
                seen_indices.add(key)
                candidate_rows.append((row, kw))

    # Append remaining rows as lower-priority fallbacks
    for i in range(min(total_rows, MAX_ROW_ATTEMPTS)):
        row = all_rows.nth(i)
        try:
            bb = await row.bounding_box()
        except Exception:
            bb = None
        key = round(bb["y"]) if bb else i
        if key not in seen_indices:
            seen_indices.add(key)
            candidate_rows.append((row, None))

    if not candidate_rows:
        print("    [-] No document rows found in table.")
        return None

    # Iterate candidate rows until we get a successful download
    for attempt_idx, (target_row, matched_kw) in enumerate(
        candidate_rows[:MAX_ROW_ATTEMPTS], start=1
    ):
        if matched_kw:
            print(f"    [+] Row {attempt_idx}: Matched keyword '{matched_kw}'")
        else:
            print(f"    [~] Row {attempt_idx}: Trying fallback row")

        # Locate icon/button in last cell, then anywhere in row
        icon_btn = target_row.locator("td").last.locator("a, button").first
        if await icon_btn.count() == 0:
            icon_btn = target_row.locator(
                "a[data-toggle='modal'], a.btn, button, a"
            ).first
        if await icon_btn.count() == 0:
            print("    [-] No clickable element in row; skipping.")
            continue

        # --- Click to open modal ---
        try:
            await icon_btn.scroll_into_view_if_needed(timeout=3000)
            await icon_btn.wait_for(state="visible", timeout=5000)
            await icon_btn.click(force=True)
            await page.wait_for_timeout(1800)   # let modal animate open
        except Exception as e:
            print(f"    [!] Click failed on row {attempt_idx}: {e}")
            continue

        # Check if a modal actually appeared
        modal = page.locator(".modal.show, .modal.in, div.modal:visible").first
        if await modal.count() == 0:
            modal = page.locator("div.modal[style*='display: block'], div.modal[style*='display:block']").first
        if await modal.count() == 0:
            modal = page.locator("div.modal").first

        modal_visible = False
        try:
            await modal.wait_for(state="visible", timeout=6000)
            modal_visible = True
        except Exception:
            pass

        if not modal_visible:
            # No modal — try direct href on the icon button itself
            print("    [~] Modal did not appear; trying direct href on icon button.")
            try:
                href = await icon_btn.get_attribute("href", timeout=3000)
            except Exception:
                href = None
            if href and href not in ("#", "") and not href.startswith("javascript"):
                full_href = (
                    href if href.startswith("http")
                    else f"https://process5.gprocurement.go.th{href}"
                )
                try:
                    response = await page.context.request.get(full_href, timeout=15000)
                    if response.ok:
                        ctype = response.headers.get("content-type", "").lower()
                        if "html" not in ctype:
                            ext = ".pdf" if "pdf" in ctype else ".zip"
                            fpath = os.path.join(
                                DOWNLOAD_DIR, f"{project_id}_row{attempt_idx}_direct{ext}"
                            )
                            with open(fpath, "wb") as f:
                                f.write(await response.body())
                            print(f"    [+] Saved via direct href: {fpath}")
                            return fpath
                        elif "egp-doc-review-web" in full_href:
                            # SPA viewer — use our token-extraction helper
                            zip_path = await _fetch_zip_from_doc_review_url(
                                page, full_href, project_id, attempt_idx
                            )
                            if zip_path:
                                return zip_path
                except Exception as e:
                    print(f"    [!] Direct href request failed: {e}")

            # Last resort: intercept any binary XHR fired by the JS click
            # (covers rows where href="#" and no modal appears)
            print(f"    [~] No href/modal — intercepting XHR triggered by JS click...")
            captured = {}

            async def _intercept(response):
                if captured.get("done"):
                    return
                ctype = response.headers.get("content-type", "").lower()
                if any(t in ctype for t in ("zip", "pdf", "octet-stream", "binary")) and response.ok:
                    try:
                        body = await response.body()
                        if len(body) > 1000:
                            ext = ".zip" if "zip" in ctype else ".pdf"
                            fpath = os.path.join(DOWNLOAD_DIR, f"{project_id}_xhr{attempt_idx}{ext}")
                            with open(fpath, "wb") as f:
                                f.write(body)
                            captured["path"] = fpath
                            captured["done"] = True
                            print(f"    [+] Captured binary XHR: {fpath}")
                    except Exception:
                        pass

            page.on("response", _intercept)
            try:
                await icon_btn.click(force=True)
                for _ in range(20):  # wait up to 10s
                    if captured.get("done"):
                        break
                    await page.wait_for_timeout(500)
            except Exception:
                pass
            finally:
                page.remove_listener("response", _intercept)

            if captured.get("path"):
                return captured["path"]

            # Also try: current page may have navigated after click
            await page.wait_for_timeout(1500)
            if page.url != original_page_url:
                try:
                    response = await page.context.request.get(page.url, timeout=15000)
                    if response.ok:
                        ctype = response.headers.get("content-type", "").lower()
                        if "html" not in ctype:
                            ext = ".pdf" if "pdf" in ctype else ".zip"
                            nav_path = os.path.join(
                                DOWNLOAD_DIR, f"{project_id}_row{attempt_idx}_nav{ext}"
                            )
                            with open(nav_path, "wb") as f:
                                f.write(await response.body())
                            print(f"    [+] Saved from navigation: {nav_path}")
                            return nav_path
                        else:
                            try:
                                await page.goto(original_page_url, wait_until="domcontentloaded", timeout=10000)
                            except Exception:
                                pass
                except Exception as e:
                    print(f"    [!] Navigation fetch failed: {e}")
            continue

        # --- Modal is open; find all candidate download buttons ---
        btn_selector = (
            "table tbody tr td a, "
            "table tbody tr td button, "
            "a.btn-icon, "
            "a.btn-light, "
            "button.btn-light, "
            "a.btn-primary, "
            "button.btn-primary, "
            "a:has-text('ดาวน์โหลด'), "
            "button:has-text('ดาวน์โหลด'), "
            "a[href*='.zip'], "
            "a[href*='.pdf']"
        )
        download_btns = modal.locator(btn_selector)
        btn_count = await download_btns.count()

        if btn_count == 0:
            # Fallback to any link or button inside modal-body
            fallback_btns = modal.locator(".modal-body a, .modal-body button")
            if await fallback_btns.count() > 0:
                download_btns = fallback_btns
                btn_count = await download_btns.count()

        if btn_count == 0:
            print("    [-] No download buttons found inside modal; skipping row.")
            await _close_modal(modal, page)
            continue

        # --- Pre-read ALL button hrefs NOW while modal is stable ---
        # This prevents stale-locator 30 s hangs during the fallback phase.
        pre_hrefs: list[str | None] = []
        for btn_i in range(btn_count):
            try:
                h = await download_btns.nth(btn_i).get_attribute("href", timeout=3000)
            except Exception:
                h = None
            pre_hrefs.append(h)

        # --- Try each download button in the modal ---
        for btn_i in range(btn_count):
            if not await modal.is_visible():
                print("    [~] Modal is no longer open; breaking button loop.")
                break
            btn = download_btns.nth(btn_i)
            try:
                result_path = await _try_download_from_btn(
                    page, modal, btn, project_id,
                    attempt=btn_i + 1,
                    pre_href=pre_hrefs[btn_i],
                )
                if result_path:
                    return result_path
            except Exception as e:
                print(f"    [!] Button {btn_i+1} failed: {e}")

        # Close modal before trying next row
        await _close_modal(modal, page)

    print("    [!] Could not complete download via any interaction mode.")
    return None


# ------------------------------------------------------------------
# PIPELINE EXECUTION STAGES
# ------------------------------------------------------------------
async def scrape_it_category_projects(page, max_projects=20) -> list:
    """Stage 1: Crawls IT category page for project links."""
    print(f"[*] [Stage 1] Navigating to IT Category page: {CATEGORY_URL}")
    await page.goto(CATEGORY_URL, wait_until="domcontentloaded", timeout=15000)
    await page.wait_for_selector("a[href*='/p/']", state="attached", timeout=10000)

    project_links = await page.query_selector_all("a[href*='/p/']")
    project_items = []
    seen_ids = set()

    for link in project_links:
        href = await link.get_attribute("href")
        if not href:
            continue
        full_url = href if href.startswith("http") else f"https://egp-gprocurement.com{href}"
        match = re.search(r"/p/(\d+)", full_url)
        if match:
            project_id = match.group(1)
            if project_id not in seen_ids:
                seen_ids.add(project_id)
                title = (await link.inner_text()).strip() or f"Project {project_id}"
                project_items.append({
                    "project_id": project_id,
                    "egp_site_url": full_url,
                    "title": title,
                })
        if len(project_items) >= max_projects:
            break

    print(f"[+] [Stage 1] Extracted {len(project_items)} project links from category page.")
    return project_items


async def process_project_stage2(context, project_item: dict) -> dict:
    """Stage 2: Navigates process5 detail page, interacts with modal, extracts files."""
    project_id = project_item["project_id"]
    egp_site_url = project_item["egp_site_url"]

    print(f"\n[===> [Stage 2] Processing Project ID: {project_id} <===]")
    print(f"[*] Opening detail page: {egp_site_url}")

    page = await context.new_page()
    result_data = {
        "project_id": project_id,
        "title": project_item["title"],
        "egp_site_url": egp_site_url,
        "official_process5_url": None,
        "zip_package": None,
        "announcement_doc": None,
        "tor_doc": None,
        "tor_docs": [],        # all matched TOR files (Attach_TOR_1, _2 …)
        "extracted_files": [],  # BENCH: every extracted file for the harness
        "submission_schedule": {},
        "status": "failed",
        "error": None,  # BENCH
    }

    try:
        await page.goto(egp_site_url, wait_until="domcontentloaded", timeout=12000)
        official_link_element = await page.query_selector("a[href*='process5.gprocurement.go.th']")

        if not official_link_element:
            print(f"  [-] Official process5 link not found for {project_id}")
            result_data["error"] = "no official e-GP detail link on aggregator"  # BENCH
            await page.close()
            return result_data

        official_url = await official_link_element.get_attribute("href")
        result_data["official_process5_url"] = official_url
        print(f"  [+] Official e-GP Link: {official_url}")

        print("  [*] Navigating to official process5 detail page...")
        await page.goto(official_url, wait_until="domcontentloaded", timeout=15000)

        # 1. Download file/bundle via modal or popup
        doc_path = await download_project_zip_bundle(page, project_id)
        result_data["zip_package"] = doc_path
        if not doc_path:
            result_data["error"] = "no document downloaded from detail page"  # BENCH

        # 2. Process download (Unzip or use direct PDF)
        if doc_path:
            extracted_info = process_downloaded_zip(doc_path, project_id)
            result_data["tor_doc"] = extracted_info["tor_doc"]
            result_data["tor_docs"] = extracted_info["tor_docs"]   # all TOR files
            result_data["announcement_doc"] = extracted_info["announcement_doc"]
            result_data["extracted_files"] = extracted_info["extracted_files"]  # BENCH

            # 3. Parse submission schedule text (prefer announcement, else primary TOR)
            ann_path = extracted_info["announcement_doc"] or extracted_info["tor_doc"]
            if ann_path:
                pdf_text = parse_pdf_text(ann_path)
                result_data["submission_schedule"] = extract_submission_schedule(pdf_text)

            result_data["status"] = (
                "success" if (result_data["tor_doc"] or result_data["announcement_doc"]) else "partial"
            )

    except Exception as e:
        print(f"  [!] Error during Stage 2 processing for {project_id}: {e}")
        result_data["error"] = str(e)  # BENCH
    finally:
        await page.close()

    return result_data


# ------------------------------------------------------------------
# MAIN RUNNER
# ------------------------------------------------------------------
def _parse_args():
    # BENCH: configurable inputs/outputs
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", help="JSON file: list of project IDs or {projectId} objects")
    parser.add_argument("--work-dir", help="Directory for downloads and extracted files")
    parser.add_argument("--out", help="Output JSON path")
    parser.add_argument("--delay-ms", type=int, default=0, help="Pause between projects")
    return parser.parse_args()


def _load_ids(path: str) -> list:
    with open(path, encoding="utf-8") as f:
        entries = json.load(f)
    items = []
    for entry in entries:
        project_id = str(entry.get("projectId") if isinstance(entry, dict) else entry)
        items.append({
            "project_id": project_id,
            "egp_site_url": f"https://egp-gprocurement.com/p/{project_id}",
            "title": (entry.get("title") if isinstance(entry, dict) else None) or f"Project {project_id}",
        })
    return items


async def main():
    global DOWNLOAD_DIR, EXTRACT_DIR, OUTPUT_JSON
    args = _parse_args()
    if args.work_dir:
        DOWNLOAD_DIR = os.path.join(args.work_dir, "downloads")
        EXTRACT_DIR = os.path.join(args.work_dir, "extracted_docs")
    if args.out:
        OUTPUT_JSON = args.out

    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    os.makedirs(EXTRACT_DIR, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        if args.ids:
            project_items = _load_ids(args.ids)
        else:
            stage1_context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            stage1_page = await stage1_context.new_page()
            project_items = await scrape_it_category_projects(stage1_page, max_projects=20)
            await stage1_context.close()

        if not project_items:
            print("[-] No projects found in Stage 1. Exiting.")
            await browser.close()
            return

        results = []
        for index, item in enumerate(project_items):
            if index and args.delay_ms:
                await asyncio.sleep(args.delay_ms / 1000)
            started = time.monotonic()  # BENCH
            proj_context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                accept_downloads=True,
            )
            res = await process_project_stage2(proj_context, item)
            await proj_context.close()
            res["ms"] = round((time.monotonic() - started) * 1000)  # BENCH
            results.append(res)

        await browser.close()

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n[🎉] Pipeline Execution Complete! Output written to {OUTPUT_JSON}")


if __name__ == "__main__":
    asyncio.run(main())
