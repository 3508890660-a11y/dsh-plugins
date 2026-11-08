/**
 * 数据模型：项目 / 大纲 / 伏笔 / 人物 / 世界观 / 章节 / 记忆。
 * 所有实体带 id + createdAt/updatedAt，JSON 持久化于 dataDir/projects/<id>/。
 */
export const GEO_TYPES = ['country', 'region', 'city', 'terrain', 'building', 'other'];
export const GEO_TYPE_LABELS = {
    country: '国家/势力',
    region: '区域/大陆',
    city: '城市/城镇',
    terrain: '地形/山川/水系',
    building: '建筑/据点',
    other: '其他',
};
export const ITEM_CATEGORIES = ['weapon', 'artifact', 'tool', 'material', 'drug', 'document', 'other'];
export const ITEM_CATEGORY_LABELS = {
    weapon: '武器',
    artifact: '法器/宝物',
    tool: '器具',
    material: '材料',
    drug: '药物',
    document: '书证/情报',
    other: '其他',
};
export const WORLDVIEW_CATEGORY_LABELS = {
    'geography': '地理',
    'history': '历史',
    'rules': '规则',
    'culture': '文化',
    'power-system': '力量体系',
    'other': '其他',
};
export const CHARACTER_ROLE_LABELS = {
    protagonist: '主角',
    supporting: '配角',
    antagonist: '反派',
    minor: '路人',
};
export function nowIso() {
    return new Date().toISOString();
}
export function uid(prefix) {
    return prefix + '-' + crypto.randomUUID().slice(0, 8);
}
/** 全部卷节点（按 order 排序） */
export function volumesSorted(data) {
    return data.outline.filter(n => n.type === 'volume').sort((a, b) => a.order - b.order);
}
/** 章节所属卷：以大纲为唯一事实来源（chapter 节点 parentId → volume 节点） */
export function chapterVolume(data, chapterNodeId) {
    const node = data.outline.find(n => n.id === chapterNodeId && n.type === 'chapter');
    if (!node || !node.parentId)
        return null;
    const vol = data.outline.find(n => n.id === node.parentId && n.type === 'volume');
    return vol ?? null;
}
/** 卷内相对章号（按 order 排序，1 起） */
export function chapterIndexInVolume(data, chapterNodeId) {
    const node = data.outline.find(n => n.id === chapterNodeId && n.type === 'chapter');
    if (!node || !node.parentId)
        return 0;
    const siblings = data.outline
        .filter(n => n.type === 'chapter' && n.parentId === node.parentId)
        .sort((a, b) => a.order - b.order);
    return siblings.findIndex(n => n.id === chapterNodeId) + 1;
}
/** 章节与其所在卷的可见标题（用于工具返回/导出）：`【第三卷】卷标题` 或空 */
export function volumeTitleOf(data, chapterNodeId) {
    const vol = chapterVolume(data, chapterNodeId);
    if (!vol)
        return '';
    const vIdx = volumesSorted(data).findIndex(v => v.id === vol.id) + 1;
    const cIdx = chapterIndexInVolume(data, chapterNodeId);
    return `第${vIdx}卷《${vol.title}》${cIdx > 0 ? `（本卷第${cIdx}章）` : ''}`;
}
/** 地理条目（按类型分组，名称排序） */
export function geoGrouped(data) {
    const m = new Map();
    for (const g of (data.geo ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))) {
        const list = m.get(g.type) ?? [];
        list.push(g);
        m.set(g.type, list);
    }
    return m;
}
/** 归一化坐标 → 四舍五入百分比（null 安全） */
export function geoCoordLabel(x, y) {
    if (x === null || y === null)
        return '';
    const px = Math.round(x * 100);
    const py = Math.round(y * 100);
    return `（坐标 ${px}%,${py}%）`;
}
//# sourceMappingURL=types.js.map