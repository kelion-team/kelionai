#!/usr/bin/env python3
import sys

from markitdown import MarkItDown


def main():
    if len(sys.argv) != 2:
        raise SystemExit(64)
    text = MarkItDown().convert(sys.argv[1]).text_content or ""
    if len(text) > 2_000_000:
        raise SystemExit(65)
    sys.stdout.buffer.write(text.encode("utf-8"))


if __name__ == "__main__":
    main()
