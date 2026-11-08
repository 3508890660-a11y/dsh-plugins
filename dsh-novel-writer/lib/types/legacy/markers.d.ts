export namespace CULTURE_MARKERS {
    namespace western {
        let label: string;
        let words: string[];
    }
    namespace eastern {
        let label_1: string;
        export { label_1 as label };
        let words_1: string[];
        export { words_1 as words };
    }
    namespace modern {
        let label_2: string;
        export { label_2 as label };
        let words_2: string[];
        export { words_2 as words };
    }
}
export namespace GENRE_MARKERS {
    let 都市: string[];
    let 玄幻: string[];
    let 仙侠: string[];
    let 西幻: string[];
    let 科幻: string[];
    let 末世: string[];
    let 无限流: string[];
    let 系统流: string[];
    let 武侠: string[];
    let 电竞: string[];
    let 校园: string[];
    let 悬疑: string[];
    let 历史: string[];
    let 克苏鲁: string[];
    let 赛博朋克: string[];
}
export namespace THEME_MARKERS {
    export let 情色R18: string[];
    export let 发疯文学: string[];
    export let 反套路: string[];
    export let 内求成长: string[];
    export let 规则怪谈: string[];
    let 无限流_1: string[];
    export { 无限流_1 as 无限流 };
    let 系统流_1: string[];
    export { 系统流_1 as 系统流 };
    export let 快穿: string[];
    export let 穿书: string[];
    export let 重生: string[];
    export let 马甲文: string[];
    let 克苏鲁_1: string[];
    export { 克苏鲁_1 as 克苏鲁 };
    export let 恐怖灵异: string[];
    export let 悬疑推理: string[];
    export let 都市职场: string[];
    let 校园_1: string[];
    export { 校园_1 as 校园 };
    export let 娱乐圈: string[];
    export let 直播: string[];
    let 电竞_1: string[];
    export { 电竞_1 as 电竞 };
    export let 玄幻修仙: string[];
    let 西幻_1: string[];
    export { 西幻_1 as 西幻 };
    export let 科幻星际: string[];
    let 末世_1: string[];
    export { 末世_1 as 末世 };
    export let 军事: string[];
    export let 年代文: string[];
    export let 种田经营: string[];
    export let 美食: string[];
    export let 宫斗宅斗: string[];
    export let 豪门总裁: string[];
    export let 甜宠: string[];
    export let 虐恋: string[];
    export let 沙雕搞笑: string[];
    export let 温馨治愈: string[];
    export let 黑暗猎奇: string[];
    export let 体育竞技: string[];
    export let 盗墓探险: string[];
}
export namespace DEFAULT_BANNED_WORDS {
    let culture: string;
    let bannedWords: string[];
    namespace recommended {
        let 老夫: string;
        let 上香: string;
        let 三炷香: string;
        let 香炉: string;
        let 丫鬟: string;
        let 门房: string;
        let 婶子: string;
        let 布鞋: string;
        let 时辰: string;
        let 府邸: string;
        let 伙计: string;
        let 掌柜: string;
        let 郎中: string;
        let 客栈: string;
        let 轿子: string;
        let 烧香: string;
    }
}
export namespace SPEECH_STYLE_RULES {
    export namespace western_1 {
        let titleGuideline: string;
        let honorBad: string[];
        namespace honorGood {
            let 提点: string;
            let 赐教: string;
            let 承蒙: string;
            let 在下: string;
            let 大人: string;
        }
        let ritualBadPatterns: RegExp[];
        let ritualGoodNote: string;
        let toneGuideline: string;
    }
    export { western_1 as western };
    export namespace eastern_1 {
        let titleGuideline_1: string;
        export { titleGuideline_1 as titleGuideline };
        let honorBad_1: string[];
        export { honorBad_1 as honorBad };
        export namespace honorGood_1 {
            let 先生: string;
            let 阁下: string;
            let 神甫: string;
            let 教堂: string;
            let 弥撒: string;
        }
        export { honorGood_1 as honorGood };
        let ritualBadPatterns_1: RegExp[];
        export { ritualBadPatterns_1 as ritualBadPatterns };
        let ritualGoodNote_1: string;
        export { ritualGoodNote_1 as ritualGoodNote };
        let toneGuideline_1: string;
        export { toneGuideline_1 as toneGuideline };
    }
    export { eastern_1 as eastern };
}
