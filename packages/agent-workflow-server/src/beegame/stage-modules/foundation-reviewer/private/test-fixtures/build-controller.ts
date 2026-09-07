/** Run the bundle audit in its own process, independently of other test builds. */
import { join, resolve, sep, basename } from 'node:path'
import { writeFile } from 'node:fs/promises'
const root = resolve(import.meta.dir, '..')
const loaded = new Set<string>()
const build = await Bun.build({ target: 'bun',
  entrypoints: [join(root, 'test-fixtures/native-controller.ts'), join(root, 'test-fixtures/native-reviewer.ts')],
  plugins: [{ name: 'controller-dependency-boundary', setup(builder) {
    builder.onLoad({ filter: /.*/ }, args => {
      loaded.add(args.path)
      if (!args.path.startsWith(root + sep) && !args.path.includes('/node_modules/zod/')) throw new Error('unexpected controller dependency: ' + args.path)
    })
  } }],
})
if (!build.success || build.logs.length) throw new Error('controller bundle failed: ' + build.logs.join('\n'))
for (const output of build.outputs) await writeFile(join(process.argv[2]!, basename(output.path)), await output.text())
console.log(JSON.stringify({ loaded: [...loaded] }))
