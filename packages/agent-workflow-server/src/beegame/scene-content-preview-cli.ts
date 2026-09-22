#!/usr/bin/env node
import { renderSceneContentPreviews } from './scene-content-preview'
import { resolve } from 'node:path'

const workspacePath = resolve(process.argv[2] ?? process.cwd())
const outputs = await renderSceneContentPreviews(workspacePath)
if (!outputs.length) throw new Error('Content package contains no Scene documents to preview.')
for (const output of outputs) process.stdout.write(`${output}\n`)
