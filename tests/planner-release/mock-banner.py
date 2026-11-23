"""Generate a synthetic placement image. This asset is never deployment input."""
from pathlib import Path
from struct import pack
from zlib import compress, crc32
import sys

def chunk(tag, contents):
    return pack(">I", len(contents)) + tag + contents + pack(">I", crc32(tag + contents))

width, height = 728, 84
line = bytes([0]) + bytes([225, 235, 250]) * width
Path(sys.argv[1]).write_bytes(
    b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    + chunk(b"IDAT", compress(line * height)) + chunk(b"IEND", b"")
)
