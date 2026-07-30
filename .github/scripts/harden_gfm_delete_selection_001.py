from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "onebot-plugin-groupguard/src/services/group_file_mirror_service.ts"
VERIFY = ROOT / "onebot-plugin-groupguard/scripts/verify-group-file-mirror.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


service = SERVICE.read_text(encoding="utf-8")
service = replace_once(
    service,
    """  if (uploadStartedAt > 0 && timed.length) {\n    const withinWindow = timed.filter(file => Math.abs(file.uploadTime - uploadStartedAt) <= 5 * 60 * 1000);\n    const candidates = withinWindow.length ? withinWindow : timed;\n    return candidates.reduce((best, candidate) => (\n      Math.abs(candidate.uploadTime - uploadStartedAt) < Math.abs(best.uploadTime - uploadStartedAt)\n        ? candidate\n        : best\n    ));\n  }\n""",
    """  if (uploadStartedAt > 0) {\n    const withinWindow = timed.filter(file => Math.abs(file.uploadTime - uploadStartedAt) <= 5 * 60 * 1000);\n    if (!withinWindow.length) return null;\n    return withinWindow.reduce((best, candidate) => (\n      Math.abs(candidate.uploadTime - uploadStartedAt) < Math.abs(best.uploadTime - uploadStartedAt)\n        ? candidate\n        : best\n    ));\n  }\n""",
    "strict upload-time selection",
)
SERVICE.write_text(service, encoding="utf-8")

verify = VERIFY.read_text(encoding="utf-8")
verify = replace_once(
    verify,
    """  assert.equal(selectedDeleteFile?.id, 'encoded-new-file-id', 'deletable encoded file ID is selected by upload time');\n  assert.equal(selectedDeleteFile?.busid, 102, 'delete_group_file busid is preserved');\n\n  const canonical = extractFileSegmentsFromMessage({\n""",
    """  assert.equal(selectedDeleteFile?.id, 'encoded-new-file-id', 'deletable encoded file ID is selected by upload time');\n  assert.equal(selectedDeleteFile?.busid, 102, 'delete_group_file busid is preserved');\n  assert.equal(selectListedGroupFileForUpload(\n    listedFiles,\n    'same-package.7z',\n    4096,\n    1785500060 * 1000,\n  ), null, 'an old same-name file outside the upload window is never guessed');\n\n  const canonical = extractFileSegmentsFromMessage({\n""",
    "old same-name regression test",
)
VERIFY.write_text(verify, encoding="utf-8")
print("GFM delete selection hardening applied")
