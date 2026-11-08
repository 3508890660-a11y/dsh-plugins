/* eslint-disable */
// ⚠️ 自动生成，请勿直接修改。
// 源文件：shared/dsh-workbench-kit/src/asset-register.ts
// 同步命令：node tools/sync-workbench-kit.mjs
/**
 * dsh-workbench-kit / asset-register
 *
 * 把各插件的生成产物登记到小说工坊的**统一资产注册表**。
 * 面板侧调用（同源 fetch，能直接拿到相对 URL）；失败一律静默——
 * 小说工坊没装/没启动时，插件自身功能不受影响。
 *
 * ⚠️ 自动生成到各插件，源文件在 shared/dsh-workbench-kit/src/asset-register.ts。
 */
const NOVEL_API = '/@dsh-external/dsh-novel-writer/api'

export interface AssetRegisterInput {
  projectId: string
  kind: 'portrait' | 'illustration' | 'map' | 'voice' | 'other'
  /** 写入方插件 id，如 dsh-illustrator */
  source: string
  /** 写入方任务 id（同 id 追加版本） */
  sourceId: string
  title: string
  /** 每个版本一个 URL（多图任务会登记成多个版本） */
  urls: string[]
  characterId?: string
  characterName?: string
  chapterId?: string
  geoId?: string
  prompt?: string
  model?: string
  provider?: string
  size?: string
  note?: string
}

/** 登记（best-effort）：返回 ok=false 时调用方可忽略 */
export async function registerAssets(input: AssetRegisterInput): Promise<{ ok: boolean; error?: string }> {
  if (!input.projectId) return { ok: false, error: '无项目，跳过登记' }
  const urls = (input.urls ?? []).filter(u => typeof u === 'string' && u)
  if (urls.length === 0) return { ok: false, error: '无产物，跳过登记' }
  let error = ''
  for (const url of urls) {
    try {
      const res = await fetch(`${NOVEL_API}/projects/${encodeURIComponent(input.projectId)}/assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: input.kind,
          source: input.source,
          sourceId: input.sourceId,
          title: input.title,
          url,
          characterId: input.characterId ?? '',
          characterName: input.characterName ?? '',
          chapterId: input.chapterId ?? '',
          geoId: input.geoId ?? '',
          prompt: input.prompt ?? '',
          model: input.model ?? '',
          provider: input.provider ?? '',
          size: input.size ?? '',
          note: input.note ?? '',
        }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
    } catch (e) {
      error = String(e).slice(0, 120)
    }
  }
  return error ? { ok: false, error } : { ok: true }
}
