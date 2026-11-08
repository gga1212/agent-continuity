#!/usr/bin/env node
// 诊断文件头：每一篇的头能不能被索引解析出来，摘要写得怎么样。
// 用法：node check-fields.mjs [档案根目录]（默认当前目录）

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

function readRaw(p) {
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return null; }
  return raw.replace(/^\uFEFF/, '');
}

function parse(raw) {
  if (!raw.startsWith('---')) return { ok: false, why: '不以 --- 开头' };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { ok: false, why: '没有结束的 ---' };
  const block = raw.slice(3, end).replace(/\r/g, '');
  const meta = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim();
  }
  return { ok: true, meta };
}

const rows = [];
for (const dir of ['log', 'diary', 'notes']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.md'))) {
    const p = path.join(d, f);
    const raw = readRaw(p);
    if (raw === null) continue;
    const r = parse(raw);
    rows.push({ rel: `${dir}/${f}`, ...r });
  }
}

const bad = rows.filter(r => !r.ok);
const noSummary = rows.filter(r => r.ok && !r.meta['摘要']);
const withSummary = rows.filter(r => r.ok && r.meta['摘要']);

const lens = withSummary.map(r => (r.meta['摘要'] || '').length).sort((a, b) => a - b);
const mid = lens.length ? lens[Math.floor(lens.length / 2)] : 0;

// 摘要写成了「讲了什么」的迹象
const tellTell = withSummary.filter(r => /^(情境|背景|本文|这篇|记录)[:：]/.test(r.meta['摘要']));
// 从正文抄的（被截断、带未闭合的粗体或反引号）
const broken = withSummary.filter(r => {
  const s = r.meta['摘要'];
  const bold = (s.match(/\*\*/g) || []).length;
  const tick = (s.match(/`/g) || []).length;
  return bold % 2 === 1 || tick % 2 === 1;
});

const miss = (k) => rows.filter(r => r.ok && !r.meta[k]).length;

console.log(`扫描 ${ROOT}`);
console.log(`  共 ${rows.length} 篇（log / diary / notes）\n`);

console.log('一、文件头能不能被解析');
if (bad.length === 0) {
  console.log('  ✓ 全部能被解析');
} else {
  console.log(`  ✗ ${bad.length} 篇解析不了：`);
  for (const r of bad) console.log(`    ${r.rel}  —— ${r.why}`);
}

console.log('\n二、摘要');
console.log(`  有摘要: ${withSummary.length} / ${rows.length}`);
if (noSummary.length) {
  console.log(`  ✗ 缺摘要 ${noSummary.length} 篇（这些在索引里等于不存在）：`);
  for (const r of noSummary.slice(0, 9)) console.log(`    ${r.rel}`);
  if (noSummary.length > 9) console.log(`    …还有 ${noSummary.length - 9} 篇`);
}
if (lens.length) {
  console.log(`  长度: 最短 ${lens[0]} / 中位 ${mid} / 最长 ${lens[lens.length - 1]}`);
  const long = withSummary.filter(r => r.meta['摘要'].length > 150);
  if (long.length) console.log(`  ⚠ ${long.length} 篇超过 150 字，检索时会被截断`);
}

console.log('\n三、摘要写的像不像「改了什么」');
if (tellTell.length) {
  console.log(`  ⚠ ${tellTell.length} 篇以「情境 / 背景 / 本文」开头——那是正文第一段，不是摘要：`);
  for (const r of tellTell.slice(0, 6)) console.log(`    ${r.rel}`);
} else {
  console.log('  ✓ 没有明显的「讲了什么」开头');
}
if (broken.length) {
  console.log(`  ⚠ ${broken.length} 篇的摘要像从正文抄的（粗体或反引号没闭合）：`);
  for (const r of broken.slice(0, 6)) console.log(`    ${r.rel}`);
}

console.log('\n四、字段完整度');
for (const k of ['标签', '状态', '关联']) {
  const n = miss(k);
  console.log(`  ${k}: ${rows.length - n} / ${rows.length} 有值${k === '标签' ? '（标签是检索第一入口，空的就只能靠摘要）' : ''}`);
}

const noDiaryLink = rows.filter(r => r.ok && !r.meta['关联']).length;
console.log(`\n五、关联`);
console.log(`  ${rows.length - noDiaryLink} / ${rows.length} 有值`);
console.log(`  （只有「内容有关」才加，不是「同一天」就加——1 组也正常）`);
