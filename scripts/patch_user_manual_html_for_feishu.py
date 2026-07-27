from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "USER_MANUAL.html"
PUBLIC_URL = "https://xn--8pv109c.top/groupguard/manual.html"

text = TARGET.read_text(encoding="utf-8")
text = re.sub(
    r"\.chips\{display:flex;gap:8px;overflow:auto;([^}]*)\}",
    r".chips{display:flex;flex-wrap:wrap;gap:8px;overflow:visible;\1}",
    text,
)
text = re.sub(
    r"\.nav\{display:flex;gap:8px;overflow:auto;([^}]*)\}",
    r".nav{display:flex;flex-wrap:wrap;gap:8px;overflow:visible;position:static;\1}",
    text,
)
text = text.replace(".chip{flex:0 0 auto;", ".chip{flex:0 1 auto;")
text = text.replace(".nav a{flex:0 0 auto;", ".nav a{flex:0 1 auto;")

fallback_css = '''
.preview-only{display:block;margin:15px 0 11px;padding:14px 16px;border-radius:17px;
background:linear-gradient(135deg,var(--blue,var(--accent,#3478f6)),var(--purple,var(--accent2,#8064ff)));
color:#fff;text-decoration:none;font-weight:850;text-align:center;
box-shadow:0 12px 28px rgba(52,120,246,.24)}
.preview-tip{margin:0 0 12px!important;padding:11px 13px;border-radius:14px;
background:rgba(255,138,52,.10);border:1px solid rgba(255,138,52,.20);
color:var(--muted)!important;font-size:13px!important;line-height:1.65!important}
html.js .preview-only,html.js .preview-tip{display:none}
.search-box input:disabled,.search input:disabled{cursor:not-allowed;opacity:.72}
.clear-btn:disabled,.search button:disabled{cursor:not-allowed;opacity:.55}
@media(max-width:650px){
  .chips,.nav{position:static!important;top:auto!important;display:grid!important;
  grid-template-columns:repeat(2,minmax(0,1fr));gap:8px!important}
  .chip,.nav a{width:100%;text-align:center;white-space:normal;line-height:1.35}
}
'''
if ".preview-only{" not in text:
    text = text.replace("</style>", fallback_css + "\n</style>", 1)

cta = (
    f'<a class="preview-only" href="{PUBLIC_URL}" target="_blank" rel="noopener">'
    "🔎 打开可搜索、可复制的网页版</a>"
    '<p class="preview-tip">飞书文件预览会限制网页脚本，因此预览里的搜索和复制按钮可能无效。'
    "点击上方按钮可使用完整功能。</p>"
)

marker = '<div class="search">'
if marker in text and "打开可搜索、可复制的网页版" not in text:
    text = text.replace(marker, cta + marker, 1)
    text = text.replace('<input id="query"', '<input id="query" disabled', 1)
    text = text.replace('<button id="clear"', '<button id="clear" disabled', 1)

marker = '<div class="search-box">'
if marker in text and "打开可搜索、可复制的网页版" not in text:
    text = text.replace(marker, cta + marker, 1)
    text = text.replace('<input id="searchInput"', '<input id="searchInput" disabled', 1)
    text = text.replace('<button class="clear-btn" id="clearBtn"', '<button class="clear-btn" id="clearBtn" disabled', 1)

enable_script = '''
<script>
document.documentElement.classList.add('js');
for (const id of ['query','searchInput','clear','clearBtn']) {
  const node = document.getElementById(id);
  if (node) node.disabled = false;
}
</script>
'''
if "document.documentElement.classList.add('js')" not in text:
    text = text.replace("</body>", enable_script + "\n</body>", 1)

TARGET.write_text(text, encoding="utf-8")
print(f"Patched Feishu fallback and public web entry: {TARGET}")
