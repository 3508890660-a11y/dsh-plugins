/**
 * 导出引擎：Markdown / TXT / EPUB。
 * EPUB 用零依赖手写 zip（store+deflate），满足 OCF 规范：mimetype 首文件不压缩。
 * 分卷：按大纲卷节点分组（chapter.parentId → volume），无卷章节平铺。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { chapterVolume, volumesSorted } from './types.js';
// ───────────────────────── 零依赖 zip ─────────────────────────
/** CRC32（IEEE 802.3） */
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++)
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
/** 生成 zip 文件（最小实现：无目录条目，store/deflate） */
function buildZip(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const dosTime = 0;
    const dosDate = 0x21; // 1980-01-01（固定值足够）
    for (const e of entries) {
        const nameBuf = Buffer.from(e.name, 'utf8');
        const crc = crc32(e.data);
        let comp = e.data;
        let method = 0; // store
        if (!e.store) {
            const deflated = deflateRawSync(e.data, { level: 6 });
            if (deflated.length < e.data.length) {
                comp = deflated;
                method = 8;
            }
        }
        // local file header
        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(20, 4); // version needed
        lfh.writeUInt16LE(0, 6); // flags
        lfh.writeUInt16LE(method, 8);
        lfh.writeUInt16LE(dosTime, 10);
        lfh.writeUInt16LE(dosDate, 12);
        lfh.writeUInt32LE(crc, 14);
        lfh.writeUInt32LE(comp.length, 18);
        lfh.writeUInt32LE(e.data.length, 22);
        lfh.writeUInt16LE(nameBuf.length, 26);
        lfh.writeUInt16LE(0, 28);
        chunks.push(lfh, nameBuf, comp);
        // central directory record
        const cdr = Buffer.alloc(46);
        cdr.writeUInt32LE(0x02014b50, 0);
        cdr.writeUInt16LE(20, 4); // version made by
        cdr.writeUInt16LE(20, 6); // version needed
        cdr.writeUInt16LE(0, 8);
        cdr.writeUInt16LE(method, 10);
        cdr.writeUInt16LE(dosTime, 12);
        cdr.writeUInt16LE(dosDate, 14);
        cdr.writeUInt32LE(crc, 16);
        cdr.writeUInt32LE(comp.length, 20);
        cdr.writeUInt32LE(e.data.length, 24);
        cdr.writeUInt16LE(nameBuf.length, 28);
        cdr.writeUInt16LE(0, 30); // extra
        cdr.writeUInt16LE(0, 32); // comment
        cdr.writeUInt16LE(0, 34); // disk
        cdr.writeUInt16LE(0, 36); // internal attrs
        cdr.writeUInt32LE(0, 38); // external attrs
        cdr.writeUInt32LE(offset, 42);
        central.push(cdr, nameBuf);
        offset += 30 + nameBuf.length + comp.length;
    }
    const centralBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...chunks, centralBuf, eocd]);
}
/** 按大纲顺序取已写章节的正文。
 * 注意：章节 order 是卷内序号 → 排序为 卷序 → 卷内序 → 未挂卷章节（按记录 order）。 */
function orderedChapters(store, data) {
    const vols = volumesSorted(data);
    const keyOf = (rec) => {
        const vol = chapterVolume(data, rec.id);
        if (vol) {
            const vi = vols.findIndex(v => v.id === vol.id);
            return [0, vi, rec.order];
        }
        return [1, 0, rec.order];
    };
    return data.chapters
        .slice()
        .sort((a, b) => {
        const ka = keyOf(a), kb = keyOf(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
    })
        .map(record => ({ record, content: store.readChapterContent(data.project.id, record.id), volume: chapterVolume(data, record.id) }))
        .filter(x => x.content.trim().length > 0);
}
/** 卷标题行（导出用）：第X卷《卷名》 */
function volumeHeading(vol, data) {
    const vi = volumesSorted(data).findIndex(v => v.id === vol.id) + 1;
    return `第${vi}卷 ${vol.title}`;
}
// ───────────────────────── 三种导出 ─────────────────────────
export function exportMarkdown(store, data, outDir) {
    const chapters = orderedChapters(store, data);
    const lines = [`# ${data.project.name}`, ''];
    if (data.project.premise)
        lines.push(`> ${data.project.premise}`, '');
    let lastVolId = null;
    for (const { record, content, volume } of chapters) {
        if (volume && volume.id !== lastVolId) {
            if (lastVolId !== null)
                lines.push('');
            lines.push(`## ${volumeHeading(volume, data)}`, '');
            if (volume.summary)
                lines.push(`> ${volume.summary}`, '');
            lastVolId = volume.id;
        }
        else if (!volume) {
            lastVolId = null;
        }
        lines.push(`${volume ? '###' : '##'} 第${record.order}章 ${record.title}`, '', content.trim(), '');
    }
    const text = lines.join('\n');
    const safeName = sanitizeFileName(data.project.name);
    const filePath = join(outDir, `${safeName}.md`);
    writeFileSync(filePath, text, 'utf8');
    return { format: 'markdown', filePath, wordCount: countWords(text), chapterCount: chapters.length };
}
export function exportTxt(store, data, outDir) {
    const chapters = orderedChapters(store, data);
    const lines = [data.project.name, '='.repeat(Math.max(data.project.name.length * 2, 10)), ''];
    if (data.project.premise)
        lines.push(data.project.premise, '');
    let lastVolId = null;
    for (const { record, content, volume } of chapters) {
        if (volume && volume.id !== lastVolId) {
            lines.push('', `【${volumeHeading(volume, data)}】`, volume.summary ? volume.summary : '', '-'.repeat(30), '');
            lastVolId = volume.id;
        }
        else if (!volume) {
            lastVolId = null;
        }
        lines.push(`第${record.order}章 ${record.title}`, '', content.trim(), '');
    }
    const text = lines.join('\n');
    const safeName = sanitizeFileName(data.project.name);
    const filePath = join(outDir, `${safeName}.txt`);
    writeFileSync(filePath, text, 'utf8');
    return { format: 'txt', filePath, wordCount: countWords(text), chapterCount: chapters.length };
}
export function exportEpub(store, data, outDir) {
    const chapters = orderedChapters(store, data);
    const vols = volumesSorted(data);
    const bookId = 'urn:uuid:' + crypto.randomUUID();
    const title = data.project.name;
    const safeName = sanitizeFileName(title);
    const entries = [];
    entries.push({ name: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii'), store: true });
    entries.push({
        name: 'META-INF/container.xml',
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, 'utf8'),
        store: false,
    });
    const css = `body{font-family:serif;line-height:1.8;margin:1.2em}
h1{text-align:center;font-size:1.6em;margin:2em 0}
h2{font-size:1.2em;margin:1.5em 0 .8em}
p{text-indent:2em;margin:.5em 0}
.premise{font-style:italic;color:#555;text-align:center}
.volpage h1{font-size:1.8em;margin:3em 0 1em}
.volpage p{text-indent:0;text-align:center;color:#444}`;
    entries.push({ name: 'OEBPS/style.css', data: Buffer.from(css, 'utf8'), store: false });
    // 分卷：卷封面页（volN.xhtml）+ 章页；无卷章节平铺
    const volPages = new Map();
    const navItems = [];
    let lastVolId = null;
    for (const { record, volume } of chapters) {
        if (volume && volume.id !== lastVolId) {
            const vi = vols.findIndex(v => v.id === volume.id) + 1;
            volPages.set(volume.id, { vi, first: true });
            navItems.push(`<itemref idref="vol${vi}"/>`);
            lastVolId = volume.id;
        }
        else if (!volume) {
            lastVolId = null;
        }
        navItems.push(`<itemref idref="${record.id}"/>`);
    }
    const navItemsStr = navItems.join('\n      ');
    const manifestItems = [
        `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
        `<item id="css" href="style.css" media-type="text/css"/>`,
        ...Array.from(volPages.entries()).map(([vid, { vi }]) => {
            const v = vols.find(x => x.id === vid);
            const safe = sanitizeFileName(v.title) || 'volume';
            return `<item id="vol${vi}" href="vol${vi}-${safe}.xhtml" media-type="application/xhtml+xml"/>`;
        }),
        ...chapters.map(({ record }) => `<item id="${record.id}" href="${record.id}.xhtml" media-type="application/xhtml+xml"/>`),
    ].join('\n    ');
    entries.push({
        name: 'OEBPS/content.opf',
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
      ${navItemsStr}
  </spine>
</package>`, 'utf8'),
        store: false,
    });
    // nav：卷 → 章 嵌套 ol；未挂卷章平铺
    const navLis = [];
    lastVolId = null;
    let openVol = false;
    const closeVol = () => { if (openVol) {
        navLis.push('    </ol>', '  </li>');
        openVol = false;
    } };
    for (const { record, volume } of chapters) {
        if (volume && volume.id !== lastVolId) {
            closeVol();
            const vi = vols.findIndex(v => v.id === volume.id) + 1;
            const safe = sanitizeFileName(volume.title) || 'volume';
            navLis.push(`  <li><a href="vol${vi}-${safe}.xhtml">${escapeXml(volumeHeading(volume, data))}</a>`, '    <ol>');
            openVol = true;
            lastVolId = volume.id;
        }
        else if (!volume) {
            closeVol();
            lastVolId = null;
        }
        navLis.push(`      <li><a href="${record.id}.xhtml">第${record.order}章 ${escapeXml(record.title)}</a></li>`);
    }
    closeVol();
    entries.push({
        name: 'OEBPS/nav.xhtml',
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <nav epub:type="toc">
    <h1>${escapeXml(title)}</h1>
${data.project.premise ? `    <p class="premise">${escapeXml(data.project.premise)}</p>` : ''}
    <ol>
    ${navLis.join('\n    ')}
    </ol>
  </nav>
</body>
</html>`, 'utf8'),
        store: false,
    });
    // 卷封面页：卷标题 + 概要（无概要则仅标题）
    for (const [vid, { vi }] of volPages) {
        const v = vols.find(x => x.id === vid);
        const safe = sanitizeFileName(v.title) || 'volume';
        const body = `<header><h1>${escapeXml(volumeHeading(v, data))}</h1></header>` +
            (v.summary ? `<p>${escapeXml(v.summary)}</p>` : '');
        entries.push({
            name: `OEBPS/vol${vi}-${safe}.xhtml`,
            data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escapeXml(volumeHeading(v, data))}</title><link rel="stylesheet" href="style.css"/></head>
<body class="volpage">
  ${body}
</body>
</html>`, 'utf8'),
            store: false,
        });
    }
    for (const { record, content } of chapters) {
        const paragraphs = content.trim().split(/\n+/)
            .map(p => p.trim())
            .filter(Boolean)
            .map(p => `<p>${escapeXml(p)}</p>`)
            .join('\n    ');
        entries.push({
            name: `OEBPS/${record.id}.xhtml`,
            data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第${record.order}章 ${escapeXml(record.title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <h2>第${record.order}章 ${escapeXml(record.title)}</h2>
    ${paragraphs}
</body>
</html>`, 'utf8'),
            store: false,
        });
    }
    const zip = buildZip(entries);
    const filePath = join(outDir, `${safeName}.epub`);
    writeFileSync(filePath, zip);
    const totalChars = chapters.reduce((n, c) => n + c.content.length, 0);
    return { format: 'epub', filePath, wordCount: totalChars, chapterCount: chapters.length };
}
// ───────────────────────── 工具函数 ─────────────────────────
function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function sanitizeFileName(s) {
    return s.replace(/[\\/:*?"<>|\s：]+/g, '_').slice(0, 60) || 'book';
}
function countWords(text) {
    // 中文按字符计，去掉空白
    return text.replace(/\s/g, '').length;
}
//# sourceMappingURL=exporter.js.map