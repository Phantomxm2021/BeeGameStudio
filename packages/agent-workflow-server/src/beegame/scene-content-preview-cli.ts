#!/usr/bin/env node
import { renderSceneContentPreviews } from './scene-content-preview'

const workspacePath = process.argv[2] ?? process.cwd()
const outputs = await renderSceneContentPreviews(workspacePath)
if (!outputs.length) throw new Error('Content package contains no Scene documents to preview.')
for (const output of outputs) process.stdout.write(`${output}\n`)
