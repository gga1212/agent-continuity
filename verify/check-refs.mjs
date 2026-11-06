// 检查包内引用指不指得到：文件存不存在、§ 节号在不在、APPENDIX 第 X 节在不在
// 用法：node verify/check-refs.mjs
// 退出码 1 = 有断链
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// 这些是「使用者的档案」里的文件，包里没有是正常的，正文提到它们不算断链
const USER_FILES = new Set([
  'AGENT.md', 'persona.md', 'STATE.md', 'events.md', 'LOG.md', 'crossings.md',
  'shifts.md', 'stream.md', 'dreams.md', 'unresolved.md', 'identity.md',
  'WORKSPACES.md', 'INDEX.md', 'NOW.md', 'digest.md', 'persona-evolution.md',
  'SOUL.md', '整理时的感受.md',
  // 正文里「你也可以叫它 X」的举例，不是引用
  '角色卡.md', '交接卡.md',
]);

// 只有这四份用 § 编号；其它文档的裸 § 是在讲使用者档案（persona §2.3 之类），跳过
const NUMBERED = new Set(['SKILL.md', 'SETUP.md', 'MANUAL.md', 'MAP.md']);

const mds = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) mds.push(p);
  }
})(ROOT);

const byName = new Map(mds.map(p => [path.basename(p), p]));

const anchors = new Map();
for (const p of mds) {
  const set = new Set();
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^#{2,6}\s+§(\d+(?:\.\d+)?)\b/);
    if (m) set.add(m[1]);
  }
  anchors.set(path.basename(p), set);
}

// APPENDIX 的 A–N
const appendixSections = new Set();
if (byName.has('APPENDIX.md')) {
  for (const line of fs.readFileSync(byName.get('APPENDIX.md'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^## ([A-N])\.\s/);
    if (m) appendixSections.add(m[1]);
  }
}

const problems = [];
for (const p of mds) {
  const name = path.basename(p);
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${name}:${i + 1}`;

    for (const m of line.matchAll(/`([\w.\-\u4e00-\u9fff]+\.md)`/g)) {
      const target = m[1];
      if (byName.has(target) || USER_FILES.has(target)) continue;
      problems.push(`${at}  文件不存在 → ${target}`);
    }

    // APPENDIX 第 X 节
    if (line.includes('APPENDIX.md')) {
      for (const m of line.matchAll(/第 ([A-N]) 节/g)) {
        if (!appendixSections.has(m[1])) problems.push(`${at}  APPENDIX 没有第 ${m[1]} 节`);
      }
    }

    // § 编号
    for (const m of line.matchAll(/§(\d+(?:\.\d+)?)/g)) {
      const num = m[1];
      const before = line.slice(0, m.index);
      const f = [...before.matchAll(/`([\w.\-]+\.md)`/g)].pop();
      if (f) {
        const target = f[1];
        if (USER_FILES.has(target)) continue;        // persona §2.3 之类
        if (!anchors.has(target)) continue;          // 已作为文件缺失报过
        if (!anchors.get(target).has(num)) problems.push(`${at}  §${num} 在 ${target} 里不存在`);
      } else if (NUMBERED.has(name)) {
        if (!anchors.get(name).has(num)) problems.push(`${at}  §${num} 在本文件里不存在`);
      }
    }
  });
}

console.log(`扫了 ${mds.length} 份 md；带 § 编号的有 ${[...NUMBERED].filter(n => byName.has(n)).length} 份；APPENDIX ${appendixSections.size} 节`);
if (!problems.length) console.log('没有断链');
else {
  console.log(`\n${problems.length} 处：`);
  for (const q of problems) console.log('  ' + q);
  process.exit(1);
}
