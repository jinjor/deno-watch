# Watch

[![Build Status](https://travis-ci.org/jinjor/deno-watch.svg?branch=master)](https://travis-ci.org/jinjor/deno-watch)
[![Build status](https://ci.appveyor.com/api/projects/status/ri4l7qbn314e1uww?svg=true)](https://ci.appveyor.com/project/jinjor/deno-watch)

A pure deno file watcher.

## Example

```typescript
import watch from "https://deno.land/x/watch@1.1.0/mod.ts";

for await (const changes of watch("src")) {
  console.log(changes.added);
  console.log(changes.modified);
  console.log(changes.deleted);
}
```

```typescript
const end = watch("src").start(changes => {
  console.log(changes);
});
```

## Options

Written in the [source code](./mod.ts).

## Benchmark

```
test Benchmark
generated 10930 files.
[Add]
took 183ms to traverse 11232 files
took 147ms to traverse 11542 files
took 142ms to traverse 11845 files
[Modify]
took 139ms to traverse 11891 files
took 136ms to traverse 11891 files
took 154ms to traverse 11891 files
[Delete]
took 138ms to traverse 11608 files
took 134ms to traverse 11274 files
took 145ms to traverse 10960 files
... ok
```

Try yourself:

```
deno https://deno.land/x/watch/test.ts --allow-write
```

## Limitations

- Changes within 1s cannot be detected.
- Symlink may not work on Windows.

## License

MIT
