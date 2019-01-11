import { writeFile, remove, mkdir, writeFileSync, platform } from "deno";
import watch from "../mod.ts";
import { test, assertEqual } from "https://deno.land/x/testing@v0.2.5/mod.ts";
import {
  inTmpDir,
  genFile,
  genDir,
  genLink,
  tree,
  inTmpDirs
} from "random-files.ts";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function assertChanges(changes, a, m, d) {
  try {
    assertEqual(changes.added.length, a);
    assertEqual(changes.modified.length, m);
    assertEqual(changes.deleted.length, d);
  } catch (e) {
    console.log("expected:", `${a} ${m} ${d}`);
    console.log("actual:", changes);
    throw e;
  }
}
test(async function Watch() {
  await inTmpDir(async tmpDir => {
    let changes = { added: [], modified: [], deleted: [] };
    const end = watch(tmpDir).start(changes_ => {
      changes = changes_;
    });
    try {
      const f = genFile(tmpDir);
      await delay(100);
      assertChanges(changes, 0, 0, 0);
      await delay(1200);
      assertChanges(changes, 1, 0, 0);
      f.modify();
      await delay(1200);
      assertChanges(changes, 0, 1, 0);
      f.remove();
      await delay(1200);
      assertChanges(changes, 0, 0, 1);
      await remove(tmpDir);
      await delay(1200);
      assertChanges(changes, 0, 0, 1);
      await mkdir(tmpDir);
      genFile(tmpDir);
      await delay(1200);
      assertChanges(changes, 1, 0, 0);
    } finally {
      await end();
    }
  });
});
test(async function singleFile() {
  await inTmpDir(async tmpDir => {
    const f = genFile(tmpDir);
    let changes = { added: [], modified: [], deleted: [] };
    const end = watch(f.path).start(changes_ => {
      changes = changes_;
    });
    try {
      await delay(1000);
      f.modify();
      await delay(1200);
      assertChanges(changes, 0, 1, 0);
      f.remove();
      await delay(1200);
      assertChanges(changes, 0, 0, 1);
      writeFileSync(f.path, new Uint8Array());
      await delay(1200);
      assertChanges(changes, 1, 0, 0);
    } finally {
      await end();
    }
  });
});

if (platform.os !== "win") {
  test(async function Symlink() {
    await inTmpDirs(2, async ([tmpDir, anotherDir]) => {
      let changes = { added: [], modified: [], deleted: [] };
      const end = watch(tmpDir, {
        followSymlink: true
      }).start(changes_ => {
        changes = changes_;
      });
      try {
        {
          const f = genFile(anotherDir);
          const link = genLink(tmpDir, f.path);
          await delay(1200);
          assertChanges(changes, 1, 0, 0);
          f.modify();
          await delay(1200);
          assertChanges(changes, 0, 1, 0);
        }
        {
          const f = genFile(anotherDir);
          const link1 = genLink(anotherDir, f.path);
          const link2 = genLink(tmpDir, link1.path);
          const link3 = genLink(tmpDir, link2.path);
          await delay(1200);
          assertChanges(changes, 1, 0, 0);
          f.modify();
          await delay(1200);
          assertChanges(changes, 0, 1, 0);
        }
        {
          const dir = genDir(anotherDir);
          const f = genFile(dir.path);
          const link = genLink(tmpDir, f.path);
          await delay(1200);
          assertChanges(changes, 1, 0, 0);
          f.modify();
          await delay(1200);
          assertChanges(changes, 0, 1, 0);
        }
      } catch (e) {
        await tree(tmpDir);
        await tree(anotherDir);
        throw e;
      } finally {
        await end();
      }
    });
  });
}

test(async function dotFiles() {
  await inTmpDir(async tmpDir => {
    let changes = { added: [], modified: [], deleted: [] };
    const end = watch(tmpDir).start(changes_ => {
      changes = changes_;
    });
    try {
      const f = genFile(tmpDir, { prefix: "." });
      await delay(1200);
      assertChanges(changes, 0, 0, 0);
      if (platform.os !== "win") {
        const link = genLink(tmpDir, f.path);
        await delay(1200);
        assertChanges(changes, 0, 0, 0);
      }
      const dir = genDir(tmpDir, { prefix: "." });
      genFile(dir.path);
      await delay(1200);
      assertChanges(changes, 0, 0, 0);
      f.remove();
      dir.remove();
      assertChanges(changes, 0, 0, 0);
    } finally {
      await end();
    }
  });
});

test(async function filter() {
  await inTmpDir(async tmpDir => {
    let result1 = [];
    const end1 = watch(tmpDir).start(changes => {
      result1 = result1.concat(changes.added);
    });
    let result2 = [];
    const end2 = watch(tmpDir, { test: ".ts$" }).start(changes => {
      result2 = result2.concat(changes.added);
    });
    let result3 = [];
    const end3 = watch(tmpDir, { ignore: ".ts$" }).start(changes => {
      result3 = result3.concat(changes.added);
    });
    let result4 = [];
    const end4 = watch(tmpDir, { test: ".(ts|css)$", ignore: ".css$" }).start(
      changes => {
        result4 = result4.concat(changes.added);
      }
    );
    try {
      genFile(tmpDir, { postfix: ".ts" });
      genFile(tmpDir, { postfix: ".js" });
      genFile(tmpDir, { postfix: ".css" });
      await delay(1200);
      assertEqual(result1.length, 3);
      assertEqual(result2.length, 1);
      assertEqual(result3.length, 2);
      assertEqual(result4.length, 1);
    } finally {
      end1();
      end2();
      end3();
      end4();
    }
  });
});

test(async function WatchByGenerator() {
  await inTmpDir(async tmpDir => {
    setTimeout(async () => {
      const f = genFile(tmpDir);
    }, 100);
    for await (const changes of watch(tmpDir)) {
      assertChanges(changes, 1, 0, 0);
      break;
    }
  });
});

if (platform.os !== "win") {
  test(async function Benchmark() {
    await inTmpDir(async tmpDir => {
      const files = [];
      generateManyFiles(tmpDir, files);
      console.log(`generated ${files.length} files.`);
      const end = watch(tmpDir).start(result => {
        console.log(
          `took ${result.time}ms to traverse ${result.fileCount} files`
        );
      });
      try {
        console.log("[Add]");
        for (let i = 0; i < 4000; i++) {
          await delay(1);
          let fileName = files[Math.floor(Math.random() * files.length)];
          fileName = fileName + "-" + i;
          await writeFile(fileName, new Uint8Array(0));
          files.push(fileName);
        }
        console.log("[Modify]");
        for (let i = 0; i < 4000; i++) {
          await delay(1);
          await writeFile(
            files[Math.floor(Math.random() * files.length)],
            new Uint8Array(0)
          );
        }
        console.log("[Delete]");
        for (let i = 0; i < 4000; i++) {
          await delay(1);
          const index = Math.floor(Math.random() * files.length);
          const fileName = files[index];
          if (fileName) {
            await remove(fileName);
          }
          files[index] = null;
        }
      } finally {
        await end();
      }
    });
  });
}

const DEPTH = 7;
const FILE_PER_DIR = 10;
const DIR_PER_DIR = 3;
function generateManyFiles(dir, files, depth = DEPTH) {
  if (depth <= 0) {
    return;
  }
  for (let i = 0; i < FILE_PER_DIR; i++) {
    try {
      const f = genFile(dir, { prefix: "f" });
      files.push(f.path);
    } catch (e) {
      console.error("dir:", dir);
      console.error(e.message);
    }
  }
  for (let i = 0; i < DIR_PER_DIR; i++) {
    const d = genDir(dir, { prefix: "d" });
    generateManyFiles(d.path, files, depth - 1);
  }
}
