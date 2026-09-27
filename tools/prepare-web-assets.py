import shutil
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
if destination.exists():
    shutil.rmtree(destination)
shutil.copytree(source, destination)
index = destination / 'index.html'
content = index.read_text(encoding='utf-8')
content = content.replace('src="/assets/', 'src="./assets/').replace('href="/assets/', 'href="./assets/')
index.write_text(content, encoding='utf-8', newline='\n')
