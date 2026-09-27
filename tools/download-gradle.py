import concurrent.futures
import os
import sys
from pathlib import Path

import requests

URL = "https://github.com/gradle/gradle-distributions/releases/download/v8.14.3/gradle-8.14.3-bin.zip"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "gradle-8.14.3-bin.zip")
PARTS = OUT.with_suffix(OUT.suffix + ".parts")
WORKERS = 16

probe = requests.get(URL, headers={"Range": "bytes=0-0"}, allow_redirects=True, timeout=60)
probe.raise_for_status()
total = int(probe.headers.get("content-range", "/0").split("/")[-1])
PARTS.mkdir(exist_ok=True)
chunk = (total + WORKERS - 1) // WORKERS

def fetch(index):
    start = index * chunk
    end = min(total - 1, start + chunk - 1)
    path = PARTS / f"{index:02d}.part"
    if path.exists() and path.stat().st_size == end - start + 1:
        return index, path.stat().st_size
    headers = {"Range": f"bytes={start}-{end}"}
    with requests.get(URL, headers=headers, allow_redirects=True, stream=True, timeout=180) as response:
        response.raise_for_status()
        received = 0
        with path.open("wb") as stream:
            for block in response.iter_content(1024 * 1024):
                if block:
                    stream.write(block)
                    received += len(block)
    expected = end - start + 1
    if received != expected:
        raise RuntimeError(f"part {index} expected {expected}, received {received}")
    return index, received

with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
    futures = [pool.submit(fetch, i) for i in range(WORKERS)]
    for future in concurrent.futures.as_completed(futures):
        index, size = future.result()
        print(f"part {index + 1}/{WORKERS}: {size / 1024 / 1024:.1f} MB", flush=True)

with OUT.open("wb") as output:
    for index in range(WORKERS):
        output.write((PARTS / f"{index:02d}.part").read_bytes())
print(f"saved {OUT} ({OUT.stat().st_size / 1024 / 1024:.1f} MB)")
