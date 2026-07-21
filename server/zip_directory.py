import json
import os
import sys
import zipfile
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "errors": ["usage: zip_directory.py SOURCE_DIR OUTPUT_ZIP"]}, ensure_ascii=False))
        return

    source_dir = Path(sys.argv[1]).resolve()
    output_zip = Path(sys.argv[2]).resolve()
    if not source_dir.is_dir():
        print(json.dumps({"ok": False, "errors": ["source directory does not exist"]}, ensure_ascii=False))
        return

    files_added = 0
    directories_added = set()
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for dirpath, dirnames, filenames in os.walk(source_dir):
            dirnames.sort()
            filenames.sort()
            for filename in filenames:
                file_path = Path(dirpath, filename)
                archive_name = file_path.relative_to(source_dir).as_posix()
                parent = Path(archive_name).parent.as_posix()
                if parent not in {"", "."} and parent not in directories_added:
                    archive.mkdir(f"{parent}/")
                    directories_added.add(parent)
                archive.write(file_path, archive_name)
                files_added += 1

    print(json.dumps({"ok": True, "filesAdded": files_added}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "errors": [str(error)]}, ensure_ascii=False))
