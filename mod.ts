import {
  readDir,
  readlink,
  lstatSync,
  lstat,
  readDirSync,
  readlinkSync,
  FileInfo,
  DenoError,
  ErrorKind
} from "deno";

/** The result of checking in one loop */
export class Changes {
  /** Paths of added files */
  added: string[] = [];
  /** Paths of modified files */
  modified: string[] = [];
  /** Paths of deleted files */
  deleted: string[] = [];
  /** The time[posix ms] when the checking started. */
  startTime: number;
  /** The time[posix ms] when the checking ended. */
  endTime: number;
  /** Current file count */
  fileCount = 0;
  /** added + modified + deleted */
  get length(): number {
    return this.added.length + this.modified.length + this.deleted.length;
  }
  /** all changed paths */
  get all(): string[] {
    return [...this.added, ...this.modified, ...this.deleted];
  }
  /** The time[ms] took for checking. */
  get time() {
    return this.endTime - this.startTime;
  }
}

/** Options */
export interface DetectorOptions {
  /** If true, watcher checks the symlinked files/directories too. */
  followSymlink?: boolean;
  /** Ignores something like .gitignore, .vscode, etc. */
  ignoreDotFiles?: boolean;
  /** Path to search in regex (ex. "\.(ts|css)$") */
  test?: RegExp | string;
  /** Path to ignore in regex. */
  ignore?: RegExp | string;
}
export interface Options extends DetectorOptions {
  /** The minimum interval[ms] of checking loop.
   * The next checking can be delayed until user program ends.
   *
   * |<------------------ interval ----------------->|<---------------
   * |<-- checking -->|                              |<-- checking -->
   *                  |<--- user program --->|
   *
   *
   * |<---------- interval --------->|       |<-----------------------
   * |<-- checking -->|                      |<-- checking -->
   *                  |<--- user program --->|
   */
  interval?: number;
}

/** The watcher */
export interface Watcher extends AsyncIterable<Changes> {
  start(
    callback: (changes: Changes) => Promise<void> | void
  ): () => Promise<void>;
}

const defaultOptions = {
  interval: 1000,
  followSymlink: false,
  ignoreDotFiles: true,
  test: /.*/,
  ignore: /$^/
};

/**
 * Watch files/directories and detect changes.
 * @example
 * // Basic usage.
 * for await (const changes of watch("src")) {
 *   console.log(changes.added);
 *   console.log(changes.modified);
 *   console.log(changes.deleted);
 * }
 * @example
 * // Kill watcher from outside of the loop.
 * const end = watch("src").start(changes => {
 *   console.log(changes);
 * });
 * end();
 * @param dirs
 * @param options
 */
export function watch(targets: string | string[], options?: Options): Watcher {
  const targets_ = Array.isArray(targets) ? targets : [targets];
  options = Object.assign({}, defaultOptions, options);
  return {
    [Symbol.asyncIterator]() {
      return run(targets_, options);
    },
    start: function(callback: (changes: Changes) => Promise<void> | void) {
      const state = {
        abort: false,
        timeout: null
      };
      const loop = (async () => {
        for await (const changes of run(targets_, options, state)) {
          await callback(changes);
        }
      })();
      return async () => {
        state.abort = true;
        if (state.timeout) {
          clearTimeout(state.timeout);
        } else {
          await loop;
        }
      };
    }
  };
}
export default watch;

async function* run(
  targets: string[],
  options: Options,
  state = {
    abort: false,
    timeout: null
  }
) {
  const detector = new Detector(targets, options);
  const { startTime } = detector.init();
  let lastStartTime = startTime;
  while (!state.abort) {
    let waitTime = Math.max(0, options.interval - (Date.now() - lastStartTime));
    await new Promise(resolve => {
      state.timeout = setTimeout(resolve, waitTime);
    });
    state.timeout = null;
    lastStartTime = Date.now();
    const changes = await detector.detectChanges();
    lastStartTime = changes.startTime;
    if (changes.length) {
      yield changes;
    }
  }
}

/** This object detects changes for one step */
export class Detector {
  public files = {};
  constructor(public targets: string[], public options: DetectorOptions) {}
  /** Call this function first to collect initial files.
   * Otherwise, all files existing at first will be marked as "ADDED" next time.
   */
  init(): { startTime: number; endTime: number; fileCount: number } {
    const filter = makeFilter(this.options);
    const changes = new Changes();
    changes.startTime = Date.now();
    collect(this.files, this.targets, this.options.followSymlink, filter);
    changes.fileCount = Object.keys(this.files).length;
    changes.endTime = Date.now();
    return changes;
  }
  /** Traverse all files and detect changes. */
  async detectChanges(): Promise<Changes> {
    const changes = new Changes();
    changes.startTime = Date.now();
    const newFiles = {};
    const filter = makeFilter(this.options);
    await walk(
      this.files,
      newFiles,
      this.targets,
      this.options.followSymlink,
      filter,
      changes
    );
    Array.prototype.push.apply(changes.deleted, Object.keys(this.files));
    this.files = newFiles;
    changes.fileCount = Object.keys(newFiles).length;
    changes.endTime = Date.now();
    return changes;
  }
}

function makeFilter({ test, ignore, ignoreDotFiles }: Options) {
  const testRegex = typeof test === "string" ? new RegExp(test) : test;
  const ignoreRegex = typeof ignore === "string" ? new RegExp(ignore) : ignore;
  return function filter(f: FileInfo, path: string) {
    if (ignoreDotFiles) {
      const splitted = path.split("/");
      const name = f.name || splitted[splitted.length - 1];
      if (/^\.[^.]+/.test(name)) {
        return false;
      }
    }
    if (f.isFile()) {
      if (!testRegex.test(path)) {
        return false;
      }
      if (ignoreRegex.test(path)) {
        return false;
      }
    }
    return true;
  };
}

async function walk(
  prev: any,
  curr: any,
  targets: (string | FileInfo)[],
  followSymlink: boolean,
  filter: (f: FileInfo, path: string) => boolean,
  changes: Changes
): Promise<void> {
  const promises = [];
  for (let f of targets) {
    let linkPath;
    let path;
    let info;
    try {
      if (typeof f === "string") {
        path = f;
        info = await (followSymlink ? statTraverse : lstat)(f);
      } else if (f.isSymlink() && followSymlink) {
        linkPath = f.path;
        info = await statTraverse(f.path);
        path = info.path;
      } else {
        path = f.path;
        info = f;
      }
    } catch (e) {
      if (e instanceof DenoError && e.kind === ErrorKind.NotFound) {
        continue;
      } else {
        throw e;
      }
    }
    if (!path) {
      throw new Error("path not found");
    }
    if (!filter(info, linkPath || path)) {
      continue;
    }
    if (info.isDirectory()) {
      const files = await readDir(path);
      promises.push(walk(prev, curr, files, followSymlink, filter, changes));
    } else if (info.isFile()) {
      if (curr[path]) {
        continue;
      }
      curr[path] = info.modified || info.created;
      if (!prev[path]) {
        changes.added.push(path);
      } else if (prev[path] < curr[path]) {
        changes.modified.push(path);
      }
      delete prev[path];
    }
  }
  await Promise.all(promises);
}

function collect(
  all: any,
  targets: (string | FileInfo)[],
  followSymlink: boolean,
  filter: (f: FileInfo, path?: string) => boolean
): void {
  for (let f of targets) {
    let linkPath;
    let path;
    let info;
    try {
      if (typeof f === "string") {
        path = f;
        info = (followSymlink ? statTraverseSync : lstatSync)(f);
      } else if (f.isSymlink() && followSymlink) {
        linkPath = f.path;
        path = readlinkSync(f.path);
        info = statTraverseSync(path);
      } else {
        path = f.path;
        info = f;
      }
    } catch (e) {
      if (e instanceof DenoError && e.kind === ErrorKind.NotFound) {
        continue;
      } else {
        throw e;
      }
    }
    if (!path) {
      throw new Error("path not found");
    }
    if (!filter(info, linkPath || path)) {
      continue;
    }
    if (info.isDirectory()) {
      collect(all, readDirSync(path), followSymlink, filter);
    } else if (info.isFile()) {
      all[path] = info.modified || info.created;
    }
  }
}

// Workaround for non-linux
async function statTraverse(path: string): Promise<FileInfo> {
  const info = await lstat(path);
  if (info.isSymlink()) {
    const targetPath = await readlink(path);
    return statTraverse(targetPath);
  } else {
    info.path = info.path || path;
    return info;
  }
}
function statTraverseSync(path: string): FileInfo {
  const info = lstatSync(path);
  if (info.isSymlink()) {
    const targetPath = readlinkSync(path);
    return statTraverseSync(targetPath);
  } else {
    info.path = info.path || path;
    return info;
  }
}
