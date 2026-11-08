/**
 * §8.2 数据 schema 迁移：把旧版 dsh-character-maker 写出的 characters.json
 * 迁移到当前 schemaVersion（见 store.ts 的 SCHEMA_VERSION）。
 *
 * 旧数据的典型漂移（技术分析 §8.2）：
 *  - `enneagram` 文案与当前知识库不一致（5 号 virtue「放下 / 清明」vs 现「超然 / 知足」、
 *    wingNick「思想家」vs 现「反传统者」、subtypeLabel「知己(反)」等）；
 *  - 多出 `persona` / `keywords` 等新代码不读不写的遗留字段；
 *  - `enneagram.presence/catchphrase/triggers/stressResponse/growthResponse` 五个字段
 *    新代码只读不写（旧数据里有、新写入路径缺失）；
 *  - 缺 9 级细分的 `levelBand` 之外的 `levelName`。
 *
 * 迁移策略：**保留用户自由文本与实测数据，重推导知识库派生字段**。
 *  - 保留：name/role/appearance/background/goal/stateNotes、mbti/bigfive/testsNote、
 *          library（六节画像）、source（novel 联动）、id/时间戳、ipipFacets/scales、作答实测标记。
 *  - 重推导：enneagram 的知识库文案（coreName/coreEn/center/fear/desire/traits/virtue/vice、
 *            箭头/wingNick/subtype/levelBand/levelName）+ behaviors/arcAdvice 模板。
 *  - 迁移掉：persona/keywords 等遗留字段挪进 `library.legacy`（不丢数据但不污染模型）。
 */
import type { Subtype } from './types.js';
/**
 * 幂等「自愈」：补齐后续版本新增的**派生字段**（不改动用户数据与既有值）。
 * 与版本迁移分开——即使 schemaVersion 已是最新，也能修好早期迁移漏掉的字段。
 * 当前补齐：enneagram.levelName（§8.14 新增的 9 级细分名）。
 * @returns 是否发生了修改
 */
export declare function healCharacter(raw: any): boolean;
/** 规范化主型（1-9，缺失/非法 → 5） */
export declare function getCore(raw: any): number;
/** 规范化健康层级（1-9，缺失/非法 → 4） */
export declare function getLevel(raw: any): number;
/** 规范化副型（sp/sx/so，缺失/非法 → sp） */
export declare function getSubtype(raw: any): Subtype;
/** 侧翼归一：接受 4 / '5w4' / 'w4' 等写法，返回相邻型号数字或 undefined */
export declare function getWing(raw: any, core: number): number | undefined;
/**
 * 迁移单个角色。就地修改 `raw` 并返回是否发生了变化。
 * @param note 迁移说明收集器（用于在 /status 里告知用户改了什么）
 */
export declare function migrateCharacter(raw: any, note: (m: string) => void): boolean;
