// Holds a source's content folder to the contracts: every lesson file read by the one parser,
// every component held to the table, the folder layout and the source record checked.
//
//   node scripts/check-content.ts <path to a content folder>
//
// Prints what it found, or the first file at fault and why, and exits non-zero.

import { ContentFault, type Folder, readContent } from '../src/content.ts'
import type { Block } from '../src/lesson.ts'

const root = process.argv[2]
if (!root) {
	console.error('usage: node scripts/check-content.ts <path to a content folder>')
	process.exit(2)
}

const counts = { folders: 0, lessons: 0, components: new Map<string, number>() }

function countBlocks(blocks: readonly Block[]): void {
	for (const block of blocks) {
		if (block.kind === 'component') {
			counts.components.set(block.name, (counts.components.get(block.name) ?? 0) + 1)
			countBlocks(block.children)
		} else if (block.kind === 'quote') {
			countBlocks(block.children)
		} else if (block.kind === 'list') {
			for (const item of block.items) countBlocks(item.children)
		}
	}
}

function countFolder(folder: Folder): void {
	counts.folders++
	countBlocks(folder.body)
	for (const child of folder.children) {
		if (child.kind === 'folder') countFolder(child)
		else {
			counts.lessons++
			countBlocks(child.body)
		}
	}
}

try {
	const content = await readContent(root)
	for (const course of content.courses) countFolder(course)
	const named = [...counts.components].sort((a, b) => b[1] - a[1])
	console.log(`${content.source.name} (${content.source.licence.spdx})`)
	console.log(`courses ${content.courses.length}, folders ${counts.folders}, lessons ${counts.lessons}`)
	console.log(`components: ${named.map(([name, n]) => `${name} ${n}`).join(', ')}`)
} catch (error) {
	if (error instanceof ContentFault) {
		console.error(`FAULT ${error.message}`)
		process.exit(1)
	}
	throw error
}
