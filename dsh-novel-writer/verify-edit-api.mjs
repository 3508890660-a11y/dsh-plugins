// verify-edit-api.mjs — 验证 novel-writer 编辑/删除 API（真实 host，可逆操作零破坏）
const API = 'http://127.0.0.1:6670/@dsh-external/dsh-novel-writer/api'
const j = (r) => r.json().catch(() => ({}))
const get = async (p) => { const r = await fetch(API + p); return { status: r.status, body: await j(r) } }
const put = async (p, b) => { const r = await fetch(API + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await j(r) } }
const del = async (p) => { const r = await fetch(API + p, { method: 'DELETE' }); return { status: r.status, body: await j(r) } }

let pass = 0, fail = 0
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name, extra) } else { fail++; console.log('FAIL', name, extra) } }

const list = (await get('/projects')).body
const pid = list.projects[0].id
console.log('project:', pid, list.projects[0].name)
const proj = (await get('/projects/' + pid)).body

// 1. PUT worldview：改标题 → 改回
const w = proj.worldview[0]
let r = await put(`/projects/${pid}/worldview/${w.id}`, { title: w.title + '·编辑测试' })
check('PUT worldview 标题', r.status === 200 && r.body.ok === true, JSON.stringify(r.body))
let proj2 = (await get('/projects/' + pid)).body
check('标题已生效', proj2.worldview.find(x => x.id === w.id).title === w.title + '·编辑测试')
r = await put(`/projects/${pid}/worldview/${w.id}`, { title: w.title })
check('标题还原', r.status === 200)

// 2. PUT worldview：改内容 → 改回
r = await put(`/projects/${pid}/worldview/${w.id}`, { content: w.content + '（编辑测试尾）' })
check('PUT worldview 内容', r.status === 200)
proj2 = (await get('/projects/' + pid)).body
check('内容已生效', proj2.worldview.find(x => x.id === w.id).content.endsWith('（编辑测试尾）'))
r = await put(`/projects/${pid}/worldview/${w.id}`, { content: w.content })
check('内容还原', r.status === 200)

// 3. PUT character：改 goal → 改回
const ch0 = proj.characters[0]
if (ch0) {
  r = await put(`/projects/${pid}/characters/${ch0.id}`, { goal: ch0.goal + '；编辑测试' })
  check('PUT character goal', r.status === 200)
  proj2 = (await get('/projects/' + pid)).body
  check('goal 已生效', proj2.characters.find(x => x.id === ch0.id).goal === ch0.goal + '；编辑测试')
  r = await put(`/projects/${pid}/characters/${ch0.id}`, { goal: ch0.goal })
  check('goal 还原', r.status === 200)
} else { console.log('SKIP character（项目无人物）') }

// 4. PUT chapter：改正文（字数联动）→ 改回
const c = proj.chapters[0]
if (c) {
  const ch = (await get(`/projects/${pid}/chapters/${c.id}`)).body
  const oc = ch.content
  const add = '\n\n（编辑测试结尾段落）'
  r = await put(`/projects/${pid}/chapters/${c.id}`, { content: oc + add })
  check('PUT chapter 正文', r.status === 200 && r.body.wordCount === (oc + add).replace(/\s/g, '').length, 'wordCount=' + r.body.wordCount)
  proj2 = (await get('/projects/' + pid)).body
  check('chapter wordCount 已更新', proj2.chapters.find(x => x.id === c.id).wordCount === (oc + add).replace(/\s/g, '').length)
  const ch2 = (await get(`/projects/${pid}/chapters/${c.id}`)).body
  check('章节文件内容已更新', ch2.content.endsWith(add))
  r = await put(`/projects/${pid}/chapters/${c.id}`, { content: oc })
  check('chapter 还原', r.status === 200 && r.body.wordCount === oc.replace(/\s/g, '').length)
} else { console.log('SKIP chapter（项目无章节）') }

// 5. 分支：DELETE 不存在 → 404
r = await del(`/projects/${pid}/worldview/nonexistent-id`)
check('DELETE 不存在条目 404', r.status === 404)

// 6. 分支：PUT 不存在条目 → 404
r = await put(`/projects/${pid}/characters/nonexistent-id`, { name: 'x' })
check('PUT 不存在条目 404', r.status === 404)

// 7. 分支：GET 编辑路径 → 405
r = await get(`/projects/${pid}/worldview/${w.id}`)
check('GET 编辑路径 405', r.status === 405)

// 8. 分支：PUT chapter 缺 content → 400
r = await put(`/projects/${pid}/chapters/${c?.id ?? 'x'}`, {})
check('PUT chapter 空 body 400', r.status === 400)

// 9. 分支：DELETE outline 不存在 → 404；存在 → 不删真节点（跳过删除验证，防误删）
r = await del(`/projects/${pid}/outline/nonexistent-id`)
check('DELETE outline 不存在 404', r.status === 404)

// 10. 分支：非法 status 白名单（bogus 被忽略，不报错）
const o = proj.outline[0]
if (o) {
  r = await put(`/projects/${pid}/outline/${o.id}`, { status: 'bogus' })
  check('PUT outline 非法 status 被忽略', r.status === 200)
  proj2 = (await get('/projects/' + pid)).body
  check('status 未变', proj2.outline.find(x => x.id === o.id).status === o.status)
} else { console.log('SKIP outline（项目无大纲）') }

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`)
process.exit(fail ? 1 : 0)
