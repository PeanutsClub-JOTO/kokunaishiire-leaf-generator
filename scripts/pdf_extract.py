#!/usr/bin/env python3
"""
PDF表抽出 sidecar (仕様書 v2.1 §9b)

pdfplumber を使ってPDFから表データを抽出し、JSONで出力する。
Node.js 側から child_process.execFile で呼び出す。

Usage:
    python3 scripts/pdf_extract.py <pdf_path>

Output (stdout): JSON
    {
        "pages": [
            {
                "page_number": 1,
                "tables": [
                    [ ["セル1", "セル2", ...], [...] ],  // 行の配列
                    ...
                ]
            }
        ],
        "error": null  // エラー時のみ文字列
    }
"""
import sys
import json

def extract_pdf(path: str) -> dict:
    try:
        import pdfplumber
    except ImportError:
        return {"pages": [], "error": "pdfplumber not installed. Run: pip install pdfplumber"}

    try:
        pages = []
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                pages.append({
                    "page_number": i + 1,
                    "tables": [
                        [
                            [str(cell) if cell is not None else "" for cell in row]
                            for row in table
                        ]
                        for table in tables
                    ]
                })
        return {"pages": pages, "error": None}
    except Exception as e:
        return {"pages": [], "error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"pages": [], "error": "Usage: pdf_extract.py <pdf_path>"}))
        sys.exit(1)

    result = extract_pdf(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
