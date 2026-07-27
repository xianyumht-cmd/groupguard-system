from pathlib import Path
import html
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "USER_MANUAL.md"
TARGET = ROOT / "USER_MANUAL.html"

lines = SOURCE.read_text(encoding="utf-8").replace("\r\n", "\n").splitlines()


def inline(text: str) -> str:
    value = html.escape(text, quote=False)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", value)
    value = re.sub(r"`([^`]+)`", r'<code class="inline">\1</code>', value)
    return value


def cells(line: str) -> list[str]:
    return [item.strip() for item in line.strip().strip("|").split("|")]


def first_code(text: str) -> str | None:
    match = re.search(r"`([^`]+)`", text)
    return match.group(1) if match else None


def render_table(block: list[str]) -> str:
    header = cells(block[0])
    rows = [cells(item) for item in block[2:]]
    out = ['<div class="table-wrap"><table><thead><tr>']
    out.extend(f"<th>{inline(item)}</th>" for item in header)
    out.append("<th>操作</th></tr></thead><tbody>")
    for row in rows:
        row += [""] * (len(header) - len(row))
        command = next((first_code(item) for item in row if first_code(item)), None)
        search = html.escape(" ".join(row), quote=True)
        out.append(f'<tr class="search-row" data-search="{search}">')
        out.extend(f"<td>{inline(item)}</td>" for item in row)
        if command:
            out.append(f'<td><button class="copy" data-copy="{html.escape(command, quote=True)}">复制</button></td>')
        else:
            out.append("<td></td>")
        out.append("</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def render_blocks(block: list[str]) -> str:
    out: list[str] = []
    paragraph: list[str] = []
    i = 0
    list_type: str | None = None

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            text = " ".join(item.strip() for item in paragraph if item.strip())
            if text:
                out.append(f"<p>{inline(text)}</p>")
            paragraph = []

    def close_list() -> None:
        nonlocal list_type
        if list_type:
            out.append(f"</{list_type}>")
            list_type = None

    while i < len(block):
        raw = block[i]
        text = raw.strip()
        if not text:
            flush_paragraph(); close_list(); i += 1; continue
        if text.startswith("### "):
            flush_paragraph(); close_list(); out.append(f"<h3>{inline(text[4:])}</h3>"); i += 1; continue
        if text.startswith("```"):
            flush_paragraph(); close_list(); i += 1; code_lines = []
            while i < len(block) and not block[i].strip().startswith("```"):
                code_lines.append(block[i]); i += 1
            i += 1
            code_text = "\n".join(code_lines).strip()
            out.append(f'<div class="code-card"><pre><code>{html.escape(code_text)}</code></pre><button class="copy" data-copy="{html.escape(code_text, quote=True)}">复制</button></div>')
            continue
        if text.startswith("|") and i + 1 < len(block) and re.match(r"^\s*\|?\s*:?-+", block[i + 1]):
            flush_paragraph(); close_list(); table = [block[i], block[i + 1]]; i += 2
            while i < len(block) and block[i].strip().startswith("|"):
                table.append(block[i]); i += 1
            out.append(render_table(table)); continue
        ordered = re.match(r"^\d+\.\s+(.*)", text)
        unordered = re.match(r"^-\s+(.*)", text)
        if ordered or unordered:
            flush_paragraph()
            wanted = "ol" if ordered else "ul"
            if list_type != wanted:
                close_list(); out.append(f'<{wanted} class="easy-list">'); list_type = wanted
            out.append(f"<li>{inline((ordered or unordered).group(1))}</li>"); i += 1; continue
        if text == "---":
            flush_paragraph(); close_list(); out.append("<hr>"); i += 1; continue
        paragraph.append(raw); i += 1
    flush_paragraph(); close_list()
    return "".join(out)


title = "GroupGuard 群管理使用手册"
meta: list[str] = []
intro: list[str] = []
sections: list[tuple[str, list[str]]] = []
current_title: str | None = None
current: list[str] = []
for line in lines:
    if line.startswith("# ") and not line.startswith("## "):
        title = line[2:].strip(); continue
    if line.startswith("> "):
        meta.append(line[2:].strip()); continue
    if line.startswith("## "):
        if current_title is None:
            intro = current
        else:
            sections.append((current_title, current))
        current_title = line[3:].strip(); current = []
    else:
        current.append(line)
if current_title is None:
    intro = current
else:
    sections.append((current_title, current))

icons = ["✅", "👥", "⛔", "🛡️", "🚪", "🤖", "⏰", "🎁", "🔎", "🎮", "🧰", "⚠️", "🗓️"]
nav = []
content = []
for index, (name, block) in enumerate(sections, 1):
    section_id = f"section-{index}"
    nav.append(f'<a href="#{section_id}">{inline(name)}</a>')
    search_text = html.escape(name + " " + " ".join(block), quote=True)
    content.append(
        f'<section class="glass section searchable" id="{section_id}" data-search="{search_text}">'
        f'<header><span>{icons[(index - 1) % len(icons)]}</span><div><small>第 {index} 部分</small><h2>{inline(name)}</h2></div></header>'
        f'{render_blocks(block)}</section>'
    )

badges = "".join(f"<b>{inline(item)}</b>" for item in meta)
page = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#eef4ff"><title>{html.escape(title)}</title><style>
:root{{--bg:#eef4ff;--bg2:#fbfdff;--text:#172033;--muted:#68748a;--glass:rgba(255,255,255,.72);--strong:rgba(255,255,255,.9);--line:rgba(255,255,255,.84);--soft:rgba(80,104,155,.14);--blue:#3478f6;--purple:#8064ff;--shadow:0 18px 55px rgba(46,69,124,.14)}}[data-theme=dark]{{--bg:#0b1020;--bg2:#141b2f;--text:#f3f6ff;--muted:#aab4ca;--glass:rgba(19,28,48,.74);--strong:rgba(27,38,63,.92);--line:rgba(255,255,255,.13);--soft:rgba(255,255,255,.09);--blue:#72a8ff;--purple:#a58eff;--shadow:0 20px 62px rgba(0,0,0,.34)}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:radial-gradient(circle at 8% 5%,rgba(68,133,255,.28),transparent 30%),radial-gradient(circle at 92% 13%,rgba(151,88,255,.22),transparent 27%),linear-gradient(145deg,var(--bg),var(--bg2));min-height:100vh}}button,input{{font:inherit}}.wrap{{max-width:1120px;margin:auto;padding:16px 14px 50px}}.glass{{background:var(--glass);border:1px solid var(--line);box-shadow:var(--shadow);backdrop-filter:blur(24px) saturate(145%);-webkit-backdrop-filter:blur(24px) saturate(145%)}}.top{{position:sticky;top:8px;z-index:20;display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:22px}}.logo{{width:44px;height:44px;display:grid;place-items:center;border-radius:14px;color:white;font-size:23px;background:linear-gradient(145deg,var(--blue),var(--purple),#22c59c)}}.top strong{{font-size:16px}}.top small{{display:block;color:var(--muted);margin-top:2px}}.top-actions{{margin-left:auto;display:flex;gap:7px}}.icon{{width:40px;height:40px;border:1px solid var(--line);background:var(--strong);border-radius:13px;cursor:pointer}}.hero{{margin-top:17px;padding:31px;border-radius:34px}}.hero em{{display:inline-block;font-style:normal;color:var(--blue);font-weight:800;background:rgba(52,120,246,.11);padding:7px 11px;border-radius:999px}}h1{{font-size:clamp(32px,6vw,54px);line-height:1.08;margin:17px 0 10px}}.hero p{{color:var(--muted);font-size:16px;line-height:1.75}}.badges{{display:flex;flex-wrap:wrap;gap:8px;margin:17px 0}}.badges b{{font-size:12px;padding:8px 10px;border:1px solid var(--line);background:var(--strong);border-radius:999px}}.search{{display:flex;gap:8px;align-items:center;padding:9px 10px 9px 15px;background:var(--strong);border:1px solid var(--line);border-radius:18px}}.search input{{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);padding:8px 0;font-size:16px}}.search button,.copy{{border:0;border-radius:11px;background:rgba(52,120,246,.12);color:var(--blue);font-weight:800;padding:8px 11px;cursor:pointer}}#result{{font-size:12px;color:var(--muted);margin-top:8px;min-height:18px}}.intro{{margin-top:15px;padding:22px;border-radius:27px}}.intro h2{{font-size:21px;margin:18px 0 10px}}.intro h2:first-child{{margin-top:0}}.nav{{display:flex;gap:8px;overflow:auto;position:sticky;top:74px;z-index:15;padding:13px 1px 9px;scrollbar-width:none}}.nav::-webkit-scrollbar{{display:none}}.nav a{{flex:0 0 auto;text-decoration:none;color:var(--muted);font-weight:750;background:var(--glass);border:1px solid var(--line);border-radius:999px;padding:9px 13px;backdrop-filter:blur(18px)}}.section{{padding:21px;margin-bottom:13px;border-radius:27px;scroll-margin-top:130px}}.section.hidden{{display:none}}.section>header{{display:flex;align-items:center;gap:12px;margin-bottom:15px}}.section>header>span{{width:48px;height:48px;display:grid;place-items:center;border-radius:16px;font-size:24px;background:linear-gradient(145deg,rgba(52,120,246,.17),rgba(128,100,255,.13));border:1px solid var(--line)}}.section small{{color:var(--blue);font-weight:800}}.section h2{{font-size:21px;margin:2px 0 0}}.section h3{{font-size:17px;margin:22px 0 10px}}.section p,.section li{{font-size:14px;line-height:1.75}}.section p{{color:var(--muted)}}.easy-list{{padding-left:22px}}.inline{{font-family:Consolas,monospace;color:var(--blue);background:rgba(52,120,246,.1);border-radius:6px;padding:2px 5px}}.code-card{{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:start;margin:10px 0;padding:11px;border-radius:16px;border:1px solid var(--soft);background:rgba(255,255,255,.28)}}[data-theme=dark] .code-card{{background:rgba(255,255,255,.035)}}pre{{margin:0;overflow:auto}}pre code{{font-family:Consolas,monospace;font-size:13px;line-height:1.7;white-space:pre-wrap}}.table-wrap{{overflow:auto;margin:10px 0;border:1px solid var(--soft);border-radius:17px}}table{{width:100%;border-collapse:collapse;min-width:620px;background:rgba(255,255,255,.2)}}th,td{{padding:11px 12px;text-align:left;border-bottom:1px solid var(--soft);font-size:13px;line-height:1.55}}th{{color:var(--muted);font-size:12px}}tr:last-child td{{border-bottom:0}}hr{{border:0;border-top:1px solid var(--soft);margin:20px 0}}.empty{{display:none;text-align:center;padding:36px;border-radius:25px;color:var(--muted)}}.empty.show{{display:block}}.toast{{position:fixed;left:50%;bottom:22px;transform:translate(-50%,14px);opacity:0;background:rgba(20,28,45,.9);color:white;padding:10px 15px;border-radius:999px;font-size:13px;font-weight:800;transition:.2s;pointer-events:none}}.toast.show{{opacity:1;transform:translate(-50%,0)}}footer{{text-align:center;color:var(--muted);font-size:12px;line-height:1.8;padding:21px 5px 0}}@media(max-width:650px){{.wrap{{padding-left:10px;padding-right:10px}}.hero{{padding:24px 18px;border-radius:28px}}.intro,.section{{padding:17px;border-radius:23px}}.top small{{display:none}}.nav{{top:68px}}.code-card{{grid-template-columns:1fr}}}}@media print{{body{{background:white}}.top,.nav,.search,.copy,.toast{{display:none!important}}.glass{{background:white;box-shadow:none;border:1px solid #ddd}}}}
</style></head><body><div class="wrap"><header class="top glass"><div class="logo">🛡️</div><div><strong>GroupGuard</strong><small>群管理使用手册 · 1.2.14</small></div><div class="top-actions"><button class="icon" id="print">🖨️</button><button class="icon" id="theme">◐</button></div></header><section class="hero glass"><em>✨ 找到指令，复制后发送</em><h1>群管理，不用记。</h1><p>完整的客户管理员说明已经直接写入本页。按分类查看，或搜索“禁言、欢迎词、查战绩”等关键词。</p><div class="badges">{badges}<b>📱 手机友好</b><b>📋 一键复制</b></div><div class="search"><span>⌕</span><input id="query" placeholder="搜索：禁言、违禁词、欢迎词、战绩……"><button id="clear">清空</button></div><div id="result">完整内容已加载。</div></section><section class="intro glass searchable" data-search="{html.escape(' '.join(intro), quote=True)}">{render_blocks(intro)}</section><nav class="nav">{''.join(nav)}</nav><main>{''.join(content)}</main><section class="empty glass" id="empty">没有找到相关内容。换一个简单词试试。</section><footer>GroupGuard 群管理使用手册<br>说明与机器人实际回复不一致时，以机器人当前回复为准。</footer></div><div class="toast" id="toast">已复制</div><script>
(()=>{{const root=document.documentElement,q=document.getElementById('query'),result=document.getElementById('result'),empty=document.getElementById('empty'),toast=document.getElementById('toast');const saved=localStorage.getItem('gg-theme');if(saved)root.dataset.theme=saved;else if(matchMedia('(prefers-color-scheme:dark)').matches)root.dataset.theme='dark';document.getElementById('theme').onclick=()=>{{root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';localStorage.setItem('gg-theme',root.dataset.theme)}};document.getElementById('print').onclick=()=>print();document.getElementById('clear').onclick=()=>{{q.value='';filter();q.focus()}};document.addEventListener('click',async e=>{{const b=e.target.closest('[data-copy]');if(!b)return;const value=b.dataset.copy;try{{await navigator.clipboard.writeText(value)}}catch(_){{const t=document.createElement('textarea');t.value=value;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove()}}toast.textContent='已复制';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1200)}});function filter(){{const term=q.value.trim().toLowerCase();let count=0;document.querySelectorAll('.section').forEach(s=>{{const ok=!term||(s.dataset.search||s.textContent).toLowerCase().includes(term);s.classList.toggle('hidden',!ok);if(ok)count++}});empty.classList.toggle('show',count===0);result.textContent=term?(count?`找到 ${{count}} 个相关分类。`:'没有找到相关内容。'):'完整内容已加载。'}}q.addEventListener('input',filter)}})();
</script></body></html>'''

TARGET.write_text(page, encoding="utf-8")
rendered = TARGET.read_text(encoding="utf-8")
required = ['class="glass section searchable"', "禁言 @成员 30", "查战绩 张三#12345", "设置欢迎词"]
forbidden = ["开发者", "需要主人权限", "设置战绩指令开关", "战绩配置"]
missing = [item for item in required if item not in rendered]
leaked = [item for item in forbidden if item in rendered]
if missing or leaked:
    raise SystemExit(f"HTML validation failed: missing={missing}, forbidden={leaked}")
print(f"Generated {TARGET.name}: {TARGET.stat().st_size} bytes, {len(sections)} sections")
