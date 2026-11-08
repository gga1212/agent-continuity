#!/usr/bin/env node
// 按需检索档案：扫文件头，默认跳过日记。
// 用法：node handoff\find.mjs <词> [<词2> …] [--all] [--limit N]
//   --all      连日记一起搜（默认只在 log/notes 里搜）
//   --limit N  最多显示几条（默认 20）
//
// 规则（2026-11-08 用户定）：
//   - 日记按天流水，检索时默认排掉，否则会把 log 淹没
//   - 但某条 log 的「关联」指向某篇日记时，那篇日记要跟出来

import fs from 'node:fs';
import path from 'node:path';

// 脚本放哪都能跑：从脚本目录往上找带 log/ 或 notes/ 的那一级（最多三层）
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 3; i++) {
    if (fs.existsSync(path.join(d, 'log')) || fs.existsSync(path.join(d, 'notes'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return start;
}
const ROOT = findRoot(HERE);

const args = process.argv.slice(2);
const words = [];
let skipDiary = false;
let body = false;
let brief = false;
let limit = 0; // 0 = 不限
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--no-diary') { skipDiary = true; continue; }
  if (a === '--body') { body = true; continue; }
  if (a === '--brief') { brief = true; continue; }
  if (a === '--limit') { limit = parseInt(args[++i] || '0', 10); continue; }
  if (a.startsWith('--')) continue;
  words.push(a);
}

if (!words.length) {
  console.log('用法：node handoff\\find.mjs <词> [<词2> …] [--all] [--limit N]');
  process.exit(0);
}

function readFront(p) {
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return null; }
  raw = raw.replace(/^\uFEFF/, '');
  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return null;
  const block = raw.slice(3, end).replace(/\r/g, '');
  const meta = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim();
  }
  return meta;
}

const rows = [];
for (const dir of ['log', 'diary', 'notes']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.md')).sort()) {
    const meta = readFront(path.join(d, f));
    if (!meta) continue;
    rows.push({
      path: `${dir}/${f}`,
      date: meta['日期'] || f.slice(0, 10),
      status: meta['状态'] || '',
      tag: meta['标签'] || '',
      link: meta['关联'] || '',
      summary: meta['摘要'] || '',
    });
  }
}

const hay = r => `${r.path} ${r.tag} ${r.summary} ${r.link} ${r.status}`.toLowerCase();
const hit = r => words.every(w => hay(r).includes(w.toLowerCase()));
// 标签或路径直接命中的排前面：那是「主题」，摘要里顺带提到的排后面
const strong = r => words.every(w => `${r.path} ${r.tag}`.toLowerCase().includes(w.toLowerCase()));

const main = rows.filter(r => !r.path.startsWith('diary/')).sort((a, b) => b.date.localeCompare(a.date));
const diary = rows.filter(r => r.path.startsWith('diary/')).sort((a, b) => b.date.localeCompare(a.date));

// 正文片段：第一个命中词前后各取一段，压掉换行
function snippet(text, word) {
  const i = text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return '';
  const s = Math.max(0, i - 40);
  const e = Math.min(text.length, i + word.length + 80);
  return text.slice(s, e).replace(/\s+/g, ' ').trim();
}

const allHits = main.filter(hit).sort((a, b) => (strong(b) ? 1 : 0) - (strong(a) ? 1 : 0));
const hits = limit > 0 ? allHits.slice(0, limit) : allHits;

// --body：frontmatter 没命中、但正文里有的（协议术语常落在这里）
const bodyHits = [];
if (body) {
  const shownPaths = new Set(hits.map(h => h.path));
  for (const r of main) {
    if (shownPaths.has(r.path)) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, r.path), 'utf8'); } catch { continue; }
    if (words.every(w => text.toLowerCase().includes(w.toLowerCase()))) {
      bodyHits.push({ ...r, snippet: snippet(text, words[0]) });
    }
  }
}

// 被命中的 log 关联到的日记（这些要「放出来」，不受 --no-diary 影响）
// 两个方向都算：log 写了「关联: diary/x」，或日记写了「关联: log/y」
const linked = new Set();
const hitPaths = new Set(hits.map(h => h.path));
for (const h of hits) {
  for (const m of h.link.matchAll(/diary\/(\d{4}-\d{2}-\d{2}\.md)/g)) linked.add(`diary/${m[1]}`);
}
for (const d of diary) {
  for (const m of (d.link || '').matchAll(/log\/[^\s,，、；;]+\.md/g)) {
    if (hitPaths.has(m[0])) linked.add(d.path);
  }
}

// 反向：某篇日记被哪些 log/notes 关联（查日记时要连事件一起看）
const linkedBy = new Map();
for (const r of main) {
  for (const m of (r.link || '').matchAll(/diary\/(\d{4}-\d{2}-\d{2}\.md)/g)) {
    const k = `diary/${m[1]}`;
    if (!linkedBy.has(k)) linkedBy.set(k, []);
    linkedBy.get(k).push(r);
  }
}

const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

console.log(`检索「${words.join(' + ')}」→ 主表 ${allHits.length} 条${skipDiary ? '（已排除日记）' : ''}`);
if (limit > 0 && allHits.length > limit) console.log(`（只显示前 ${limit} 条）`);
if (!brief) console.log('（摘要全文；加 --brief 截短）');
console.log('');

for (const r of hits) {
  console.log(`${r.path}  ${r.date}${r.status ? '  [' + r.status + ']' : ''}${strong(r) ? '  ★' : ''}`);
  console.log(`  ${brief ? cut(r.summary, 150) : r.summary}`);
  if (r.tag) console.log(`  标签：${r.tag}`);
  console.log('');
}

// body 里的命中：frontmatter 没写，但正文有——术语常落在这里
if (bodyHits.length) {
  console.log(`—— 正文里命中（${bodyHits.length} 篇，摘要没提这个词）——`);
  for (const r of bodyHits) {
    console.log(`${r.path}  ${r.date}`);
    console.log(`  …${r.snippet}…`);
  }
  console.log('');
}

// 日记里的命中（--no-diary 时跳过这一段）
const shownDiary = new Set();
if (!skipDiary) {
  const dhAll = diary.filter(hit);
  const dh = limit > 0 ? dhAll.slice(0, limit) : dhAll;
  if (dh.length) {
    console.log(`—— 日记里的命中（${dh.length} 篇）——`);
    for (const r of dh) {
      shownDiary.add(r.path);
      console.log(`${r.path}  ${r.date}`);
      console.log(`  ${brief ? cut(r.summary, 120) : r.summary}`);
      // 查日记要连事件一起看：把关联它的 log/notes 的摘要也打出来
      const by = linkedBy.get(r.path) || [];
      if (by.length) {
        console.log('  ↑ 关联它的记录：');
        for (const b of by) {
          console.log(`    ${b.path}  ${b.date}${b.status ? '  [' + b.status + ']' : ''}`);
          console.log(`      ${brief ? cut(b.summary, 120) : b.summary}`);
        }
      }
      console.log('');
    }
  }
}

// 关联到的日记：始终列，放在最后——它没命中关键词，只是和上面某条挂着关系
const rel = diary.filter(r => linked.has(r.path) && !shownDiary.has(r.path));
if (rel.length) {
  console.log(`—— 关联到的日记（${rel.length} 篇，没命中关键词，只是和上面某条相关）——`);
  for (const r of rel) {
    console.log(`${r.path}  ${r.date}`);
    console.log(`  ${brief ? cut(r.summary, 120) : r.summary}`);
  }
  console.log('');
}
