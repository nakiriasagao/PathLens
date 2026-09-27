import os
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

path = sys.argv[1]
fd, temp_path = tempfile.mkstemp(suffix='.apk', dir=os.path.dirname(path))
os.close(fd)
try:
    with ZipFile(path, 'r') as source, ZipFile(temp_path, 'w') as target:
        for item in source.infolist():
            normalized = item.filename.replace('\\', '/')
            clone = ZipInfo(normalized, item.date_time)
            clone.compress_type = item.compress_type if item.compress_type in (0, ZIP_DEFLATED) else ZIP_DEFLATED
            clone.external_attr = item.external_attr
            clone.comment = item.comment
            clone.extra = item.extra
            target.writestr(clone, source.read(item.filename))
    os.replace(temp_path, path)
finally:
    if os.path.exists(temp_path):
        os.remove(temp_path)
