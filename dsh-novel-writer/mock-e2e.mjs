/**
 * mock-e2e.mjs — 无 LLM 全链路验证：
 * 15 个 novel_* 工具 execute 直调（数据层 + 工具逻辑 + 记忆闭环 + 三格式导出）。
 * 运行：node mock-e2e.mjs  （须在 dsh-novel-writer 包内以解析 node_modules junction）
 */
import { Store } from './lib/store.js'
import { buildTools } from './lib/tools.js'
import { nowIso, uid } from './lib/types.js'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'novel-e2e-'))
const store = new Store(dataDir)
let failures = 0
const check = (cond, label) => {
  if (cond) { console.log(`  PASS ${label}`) } else { failures++; console.log(`  FAIL ${label}`) }
}

// mock generator：只在 execute 流程中被消费，返回值固定
const generator = {
  lastSessionRoute: null,
  effectiveRoute: () => ({ provider: 'mock', model: 'mock-1' }),
  async generate() { return '# 第一章 迷雾中的剑\n\n夜风穿过巷口，少年握紧了手中的短剑。这柄剑今天救了他的命，也让他欠下一条无法偿还的债。' },
  async extractMemory(data, title, content, open) {
    return {
      summary: `本章摘要：${title}`,
      events: ['少年在巷战中活下来', '短剑暴露了神秘纹章'],
      characterUpdates: [{ name: '少年·阿尔', change: '受伤，获得短剑并决定追查纹章来历' }],
      items: ['神秘短剑（刻有纹章）'],
      foreshadowingPlanted: ['短剑纹章与千年前灭国传说有关'],
      foreshadowingResolved: open.length ? [open[0].id] : [],
    }
  },
  buildSystemPrompt: () => 'mock system',
  buildChapterPrompt: () => 'mock prompt',
  async parseSettingsFile(data, fileName, content, mode) {
    const extra = content.includes('第二文件')
      ? [{ category: 'culture', title: '第二文件条目', content: '来自第二个文件的独特条目' }]
      : []
    return {
      worldview: [{ category: 'rules', title: '灰烬法则', content: '灰烬之下不得燃火，违者灰烬加身。' }, ...extra],
      characters: [{ name: '守夜人·赫尔', aliases: ['赫尔'], role: 'supporting', appearance: '', personality: '', background: '塔楼守夜人', goal: '', possessions: ['提灯'], relationships: [] }],
      outline: [{ type: 'chapter', title: '外传 守夜人', summary: '赫尔守塔一夜', beats: ['发现灰烬异动', '与阿尔相遇'] }],
      foreshadowings: [{ description: '赫尔背后的烙印与灰烬法则同源', notes: '' }],
    }
  },
  importLongThreshold: 20000,
  async parseSettingsFileLong(data, fileName, content, mode) {    const chunkChars = 15000
    const n = Math.max(1, Math.ceil(content.length / chunkChars))
    const parsed = {
      worldview: Array.from({ length: n }, (_, i) => ({ category: 'rules', title: `分块条目-${i + 1}`, content: `第${i + 1}块提取的设定` })),
      characters: [],
      outline: [],
      foreshadowings: [],
    }
    return { parsed, chunks: n, usedCloud: true, truncated: n > 20 }
  },
  async polishChapter(data, node, content, opts) {
    return `[润色稿-${opts.mode}]` + content + (opts.focus ? `（方向：${opts.focus}）` : '')
  },
}

const tools = Object.fromEntries(buildTools({ store, generator }).map(t => [t.name, t]))
const call = async (name, args) => {
  try {
    const r = await tools[name].execute(args ?? {})
    console.log(`✓ ${name} ->`, JSON.stringify(r).slice(0, 200))
    return r
  } catch (e) {
    failures++
    console.log(`✗ ${name} THREW:`, String(e).slice(0, 300))
    return null
  }
}

// ═══ 1. 项目 ═══
const p = await call('novel_project_create', { name: '剑与灰烬', genre: '奇幻', style: '冷峻的日轻风', premise: '亡国少年持神秘短剑踏上复仇与救赎之路' })
const pid = p?.id
check(!!pid, '项目创建返回 id')

// ═══ 2. 大纲（卷→章→beat）═══
const v1 = await call('novel_outline_edit', { projectId: pid, type: 'volume', title: '第一卷 灰烬之下', summary: '少年阿尔在亡国废墟中觉醒' })
const c1 = await call('novel_outline_edit', { projectId: pid, type: 'chapter', title: '第一章 迷雾中的剑', order: 1, summary: '巷战夜袭，阿尔获得短剑', beats: ['巷战遭遇追兵', '短剑显威', '阿尔决定追查纹章'], parentId: v1?.id, status: 'done' })
const c2 = await call('novel_outline_edit', { projectId: pid, type: 'chapter', title: '第二章 纹章的呼唤', order: 2, summary: '阿尔循纹章线索进入废弃神庙', beats: ['发现千年前壁画', '遭遇守庙人', '得知灭国传说'], parentId: v1?.id })
const tree = await call('novel_outline_list', { projectId: pid })
check(tree && tree.outline?.includes('第二章'), '大纲含 2 章')

// ═══ 3. 人物 ═══
const ch = await call('novel_character_edit', { projectId: pid, name: '少年·阿尔', role: 'protagonist', appearance: '灰发，消瘦，左臂缠着绷带', personality: '隐忍，重诺，外冷内热', background: '亡国骑士团遗孤', goal: '查明纹章真相并为故乡复仇', location: '边境城·灰港', condition: '轻伤', possessions: ['破旧斗篷'] })
check(!!ch?.id, '人物创建返回 id')

// ═══ 4. 世界观 ═══
await call('novel_worldview_edit', { projectId: pid, category: 'geography', title: '灰港', content: '边境贸易城，三教九流汇聚，亡国难民聚集地。' })
await call('novel_worldview_edit', { projectId: pid, category: 'history', title: '烬之王国', content: '十年前被邻国联军所灭，王室血脉据说断绝。' })
const wv = await call('novel_worldview_list', { projectId: pid })
check(wv && wv.count === 2, '世界观 2 条')

// ═══ 5. 伏笔（手动埋一条，验证 chapter_write 会回收）═══
const f = await call('novel_foreshadowing_edit', { projectId: pid, description: '阿尔的旧斗篷内侧绣着烬之王国的纹章', status: 'open' })
check(!!f?.id, '伏笔创建返回 id')

// ═══ 6. 章节生成（核心：mock 正文 + 记忆提取 → 状态更新）═══
const w1 = await call('novel_chapter_write', { projectId: pid, chapterId: c1?.id })
check(!!w1?.wordCount && w1.wordCount > 0, '章节生成字数统计')
check(w1?.memory?.includes('人物变化'), '记忆提取出人物变化')
check(w1?.memory?.includes('新伏笔'), '记忆提取出新增伏笔')
check(w1?.memory?.includes('回收伏笔'), '回收了手动埋的伏笔')
const full1 = await call('novel_chapter_get', { projectId: pid, chapterId: c1?.id, withContent: true })
check(full1?.content?.includes('迷雾中的剑'), '章节正文可读回')

// ═══ 7. 续写（append）═══
const c2w = await call('novel_chapter_write', { projectId: pid, chapterId: c2?.id })
check(!!c2w, '第二章生成')
const ap = await call('novel_chapter_continue', { chapterId: c2?.id, mode: 'append', instructions: '加入守庙人与阿尔的对峙' })
check(!!ap?.addedText, 'append 返回新正文')

// ═══ 8. 手动修正记忆 ═══
const mu = await call('novel_memory_update', { chapterId: c1?.id, summary: '修正后的摘要', events: ['e1', 'e2'], items: ['神秘短剑'] })
check(!!mu, '记忆修正调用成功')

// ═══ 9. 人物状态已更新（applyMemory 效果）═══
const chars = await call('novel_character_list', { projectId: pid, detail: true })
check(chars?.characters?.includes('受伤'), '人物 currentState.notes 被记忆更新')
check((chars?.characters?.match(/\[第2章\] 受伤/g) || []).length === 1, 'notes 去重：第2章变化仅一条')

// ═══ 10. 设定文件导入（AI 解析：dryRun / 正式 / 幂等）═══
const settingFile = join(tmpdir(), `novel-setting-${Date.now()}.md`)
writeFileSync(settingFile, '# 世界设定\n\n## 灰烬法则\n灰烬之下不得燃火，违者灰烬加身。\n\n## 人物\n守夜人赫尔：塔楼守夜人，手持提灯。', 'utf8')
const dr = await call('novel_import_settings', { projectId: pid, filePath: settingFile, dryRun: true })
check(dr?.imported?.includes('世界观 1'), 'dryRun 解析出世界观 1 条')
check(dr?.preview?.includes('预览模式'), 'dryRun 标记预览模式')
const wvAfterDry = await call('novel_worldview_list', { projectId: pid })
check(wvAfterDry?.count === 2, 'dryRun 未写入（世界观仍 2 条）')
const im = await call('novel_import_settings', { projectId: pid, filePath: settingFile })
check(im?.imported?.includes('世界观 1') && im?.imported?.includes('人物 1') && im?.imported?.includes('大纲 1') && im?.imported?.includes('伏笔 1'), '正式导入四类各 1')
const wvAfter = await call('novel_worldview_list', { projectId: pid })
check(wvAfter?.count === 3, '导入后世界观 3 条')
const im2 = await call('novel_import_settings', { projectId: pid, filePath: settingFile })
check(im2?.skipped?.includes('灰烬法则') && im2?.imported?.includes('世界观 0'), '重复导入全跳过（幂等）')
rmSync(settingFile, { force: true })

// 多文件一次导入 + 坏路径容错
const sf1 = join(tmpdir(), `ns1-${Date.now()}.md`)
const sf2 = join(tmpdir(), `ns2-${Date.now()}.md`)
writeFileSync(sf1, '第一文件', 'utf8')
writeFileSync(sf2, '第二文件内容', 'utf8')
const multi = await call('novel_import_settings', { projectId: pid, filePath: sf1 + '\n' + sf2 })
check(multi?.files?.includes('文件 2 个'), '多文件报告文件数 2')
check(multi?.imported?.includes('世界观 1'), '多文件：第二文件新增 1 条世界观（第一文件条目已存在被跳过）')
const multiBad = await call('novel_import_settings', { projectId: pid, filePath: sf1 + ';' + join(tmpdir(), '不存在-xxx.md') })
check(multiBad?.preview?.includes('无法读取') && multiBad?.preview?.includes('不存在-xxx'), '坏路径计入错误清单且不中断')
rmSync(sf1, { force: true })
rmSync(sf2, { force: true })

// 超长文本分块解析（>20000 字符 → parseSettingsFileLong，每块 15000 字符）
const longFile = join(tmpdir(), `long-setting-${Date.now()}.md`)
const row = '灰烬城的地理与历史设定段落。'
// 66 行 × 650 字符 ≈ 42900 字符 → 恰好 3 块（15000 字符/块）
const longContent = '# 超长设定集\n\n' + Array.from({ length: 66 }, () => row.repeat(50)).join('\n')
writeFileSync(longFile, longContent, 'utf8')
check(longContent.length > 20000, `超长文件构造成功（${longContent.length} 字符）`)
const ld = await call('novel_import_settings', { projectId: pid, filePath: longFile, dryRun: true })
check(ld?.preview?.includes('分块 4 段') && ld?.preview?.includes('云端大模型'), 'dryRun 超长文件分块 4 段·云端大模型')
check(ld?.imported?.includes('世界观 4'), 'dryRun 分块合并出世界观 4 条')
const wvAfterLong = await call('novel_worldview_list', { projectId: pid })
check(wvAfterLong?.count === 4, 'dryRun 未写入（世界观仍 4 条）')
const li = await call('novel_import_settings', { projectId: pid, filePath: longFile })
check(li?.imported?.includes('世界观 4'), '正式导入分块结果 4 条世界观')
const wvAfterLong2 = await call('novel_worldview_list', { projectId: pid })
check(wvAfterLong2?.count === 8, '导入后世界观 8 条（4+4）')
const li2 = await call('novel_import_settings', { projectId: pid, filePath: longFile })
check(li2?.imported?.includes('世界观 0') && li2?.skipped?.includes('分块条目-1'), '超长文件重复导入全跳过（幂等）')
rmSync(longFile, { force: true })

// ═══ 12. AI 智能编辑：章节润色（预览不落盘 / 落盘+备份）═══
const polPrev = await call('novel_chapter_polish', { projectId: pid, chapterId: c1?.id, mode: 'light', save: false })
check(polPrev?.save === false && polPrev?.polished?.includes('[润色稿-light]'), '润色预览（save=false）返回润色稿不落盘')
const polBefore = await call('novel_chapter_get', { projectId: pid, chapterId: c1?.id, withContent: true })
const pol = await call('novel_chapter_polish', { projectId: pid, chapterId: c1?.id, mode: 'deep', focus: '对话更口语化' })
check(pol?.save === true && pol?.wordCount > 0, '润色落盘返回字数')
const polAfter = await call('novel_chapter_get', { projectId: pid, chapterId: c1?.id, withContent: true })
check(polAfter?.content !== polBefore?.content && polAfter?.content?.includes('方向：对话更口语化'), '正文已被润色稿覆盖')
const backupDir = join(dataDir, 'projects', pid, 'chapters', 'backup')
const bfiles = existsSync(backupDir) ? readdirSync(backupDir) : []
check(bfiles.some(f => f.startsWith(c1?.id + '-')), '原文已备份到 chapters/backup/')
// 空章节润色 → 报错（无正文）——期望抛错，手动 try/catch 不计失败
try {
  await tools['novel_chapter_polish'].execute({ projectId: pid, chapterId: 'no-such-ch', save: false })
  failures++; console.log('  FAIL 润色不存在的章节应报错')
} catch (e) {
  console.log('  PASS 润色不存在的章节报错 ->', String(e).slice(0, 40))
}

// ═══ 13. 导出三格式 ═══
const ex = await call('novel_export', { projectId: pid, format: 'markdown' })
check(ex?.filePath?.endsWith('.md'), 'markdown 导出')
await call('novel_export', { projectId: pid, format: 'txt' })
await call('novel_export', { projectId: pid, format: 'epub' })
const outDir = store.exportDir(pid)
const files = existsSync(outDir) ? readdirSync(outDir) : []
console.log('  导出目录:', outDir, '->', files)
check(files.some(f => f.endsWith('.md')), '存在 .md')
check(files.some(f => f.endsWith('.txt')), '存在 .txt')
check(files.some(f => f.endsWith('.epub')), '存在 .epub')
for (const f of files) {
  if (f.endsWith('.epub')) {
    const buf = readFileSync(join(outDir, f))
    check(buf.slice(0, 2).toString() === 'PK', '.epub 为 zip 魔数 PK')
    const s = buf.toString('latin1')
    check(s.includes('mimetype'), '.epub 含 mimetype 条目')
  } else {
    const t = readFileSync(join(outDir, f), 'utf8')
    check(t.includes('剑与灰烬'), `${f} 内容含书名`)
  }
}

// ═══ 11. 列表 / 模型状态 ═══
const lst = await call('novel_project_list')
check(lst?.count >= 1, '项目列表')
await call('novel_model_status')

// ═══ 清理 ═══
rmSync(dataDir, { recursive: true, force: true })
console.log(failures === 0 ? '\n═══ ALL PASS ═══' : `\n═══ ${failures} FAILURE(S) ═══`)
process.exit(failures === 0 ? 0 : 1)
