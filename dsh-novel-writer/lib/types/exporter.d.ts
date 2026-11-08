import type { ProjectData } from './types.js';
export interface ExportResult {
    format: 'markdown' | 'txt' | 'epub';
    filePath: string;
    wordCount: number;
    chapterCount: number;
}
interface ChapterReader {
    readChapterContent(p: string, c: string): string;
}
export declare function exportMarkdown(store: ChapterReader, data: ProjectData, outDir: string): ExportResult;
export declare function exportTxt(store: ChapterReader, data: ProjectData, outDir: string): ExportResult;
export declare function exportEpub(store: ChapterReader, data: ProjectData, outDir: string): ExportResult;
export {};
