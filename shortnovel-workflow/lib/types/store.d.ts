import type { ShortNovelProject, ProjectMeta } from './types.js';
export declare class ShortNovelStore {
    private dataDir;
    private cache;
    constructor(dataDir: string);
    private projectDir;
    private dataFile;
    private writeJson;
    createProject(meta: {
        id: string;
        topic: string;
        genre: string;
        style: string;
        title: string;
        targetChars: number;
    }): ShortNovelProject;
    listProjects(): ProjectMeta[];
    load(id: string): ShortNovelProject;
    save(id: string): void;
    delete(id: string): void;
}
