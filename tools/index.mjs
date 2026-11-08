#!/usr/bin/env node
// 档案索引：扫描文件头，生成 _index.md（只读视图，不要手改）。
// 用法：node handoff\index.mjs
//
// 设计（2026-11-08 定，下午改）：
//   - 人写的进文件头（类型 / 日期 / 状态 / 标签 / 摘要 / 关联），机器只读不写
//   - 只做「读出来排成表」，不做校验、不判断写得好不好
//   - **不标「整理过没有」**——那归 cursor.md（游标之前的算已整理）
//   - **日记单独一节**：它按天流水，和 log 的读法不同；检索时默认跳过，
//     但被某条 log 的「关联」指到的，要能跟出来
//   - 「读取选择」不设列：类型决定读法

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
// 不能叫 index.md：Windows 大小写不敏感，会覆盖原有的大写 INDEX.md（2026-11-08 踩过）
const OUT = path.join(ROOT, '_index.md');

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const STAMP = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

function readFront(p) {
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return null; }
  raw = raw.replace(/^\uFEFF/, '');
  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return null;
  // 文件是 CRLF；`.` 不匹配 \r，不先去掉会解析出空对象（2026-11-08 踩过）
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
    rows.push({
      path: `${dir}/${f}`,
      type: meta ? (meta['类型'] || dir) : dir,
      date: (meta && meta['日期']) || f.slice(0, 10),
      status: meta ? (meta['状态'] || '') : '',
      tag: meta ? (meta['标签'] || '') : '',
      link: meta ? (meta['关联'] || '') : '',
      summary: meta ? (meta['摘要'] || '') : '',
      indexed: !!(meta && meta['摘要']),
    });
  }
}

const main = rows.filter(r => !r.path.startsWith('diary/')).sort((a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));
const diary = rows.filter(r => r.path.startsWith('diary/')).sort((a, b) => b.date.localeCompare(a.date));
const no = rows.filter(r => !r.indexed);

const lines = [];
lines.push('# 档案索引（生成视图，不要手改）');
lines.push('');
lines.push(`> 生成于 ${STAMP}　·　覆盖 **${rows.length - no.length} / ${rows.length}**　·　构成 log/notes ${main.length} · diary ${diary.length}`);
lines.push('> 命令：`node handoff\\index.mjs`　·　检索：`node handoff\\find.mjs <词>`（默认全局；查事件时加 `--no-diary`）');
lines.push('> **整理到哪看 `cursor.md`**——游标之前的算已整理，本文件不标。');
lines.push('> **状态**列写「这件事现在到哪一步」（已定 / 挂起 / 待验 / 已执行），没写就是没标。');
lines.push('');
lines.push('## 一、判断与专题（按日期倒序）');
lines.push('');
lines.push('| 路径 | 类型 | 日期 | 状态 | 标签 | 关联 | 摘要 |');
lines.push('|---|---|---|---|---|---|---|');
for (const r of main) {
  lines.push(`| ${r.path} | ${r.type} | ${r.date} | ${r.status || ''} | ${r.tag || '-'} | ${r.link || '-'} | ${r.summary.replace(/\|/g, '\\|')} |`);
}
lines.push('');
lines.push(`## 二、日记（${diary.length} 篇，按天；检索默认跳过）`);
lines.push('');
lines.push('| 路径 | 日期 | 标签 | 关联 | 摘要 |');
lines.push('|---|---|---|---|---|');
for (const r of diary) {
  lines.push(`| ${r.path} | ${r.date} | ${r.tag || '-'} | ${r.link || '-'} | ${r.summary.replace(/\|/g, '\\|')} |`);
}
lines.push('');
if (no.length) {
  lines.push(`## 三、还没有文件头（${no.length} 篇）`);
  lines.push('');
  lines.push(no.map(r => r.path).join('　·　'));
  lines.push('');
}

// 标签频次：写标签前先扫这一块，优先用已有的词——用过的词自然就是词表
const tagCount = new Map();
for (const r of rows) {
  for (const t of r.tag.split(/[,，、\s]+/).filter(Boolean)) {
    tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
}
const tagLine = [...tagCount.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([t, n]) => `${t} ${n}`)
  .join(' · ');
lines.push('## 四、标签（按频次，写新的先扫这里）');
lines.push('');
lines.push(tagLine || '（还没有）');
lines.push('');

// 人格文件条目：扫 `## #N` 标题 + 条目里的 `关联：` 行
const personRows = [];
for (const f of ['self/persona.md', 'self/events.md', 'self/identity.md', 'self/crossings.md']) {
  let raw;
  try { raw = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  for (const part of raw.split(/\n(?=## )/)) {
    const h = part.match(/^## (#\S+)?\s*(.*)$/m);
    if (!h) continue;
    const title = h[2].replace(/\s*【.*?】\s*/g, '').replace(/\r/g, '').trim().slice(0, 44);
    const rel = part.match(/关联[:：]\s*(.+)/);
    personRows.push({ file: f, id: h[1] || '—', title, link: rel ? rel[1].replace(/\r/g, '').trim() : '' });
  }
}
lines.push('## 五、人格文件条目');
lines.push('');
lines.push('| 文件 | 编号 | 标题 | 关联 |');
lines.push('|---|---|---|---|');
for (const r of personRows) {
  lines.push(`| ${r.file} | ${r.id} | ${r.title} | ${r.link} |`);
}
lines.push('');

try {
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`_index.md：覆盖 ${rows.length - no.length}/${rows.length}，主表 ${main.length}，日记 ${diary.length}，人格条目 ${personRows.length}`);
} catch (e) {
  console.error('写入失败：', e.message);
  process.exit(1);
}
