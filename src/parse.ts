/**
 * The ONE reader of lesson files: Markdown in, a `Lesson` out (./lesson.ts), or the faults
 * that stop it being one.
 *
 * The Markdown is read by remark with two additions: GitHub's task lists (a question's
 * choices), and MDC, the block syntax Nuxt Content reads components in (`::name{key="value"}`
 * … `::`, one more colon for a component inside another). So a lesson file means the same
 * thing here and in a Nuxt site that reads the same repository.
 *
 * Every reader of lesson files goes through this function, so there is one answer to what a
 * file says. It refuses what a lesson file may not hold (raw HTML, a table, a code block, a
 * component the table does not list) and says where.
 */

import remarkGfm from 'remark-gfm'
import remarkMdc from 'remark-mdc'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { z } from 'zod'
import { faultsOf } from './components.ts'
import type { Block, Inline, Lesson, ListItem } from './lesson.ts'

const reader = unified().use(remarkParse).use(remarkGfm).use(remarkMdc)

// What remark hands over, read as far as each kind of node is used. The tree arrives typed
// only loosely (MDC adds node kinds of its own), so each node is read through a schema.
const anyNode = z.looseObject({ type: z.string() })
const parent = z.looseObject({ children: z.array(z.unknown()) })
const valued = z.looseObject({ value: z.string() })
const headingNode = z.looseObject({ depth: z.number(), children: z.array(z.unknown()) })
const linkNode = z.looseObject({
	url: z.string(),
	title: z.string().nullish(),
	children: z.array(z.unknown()),
})
const imageNode = z.looseObject({ url: z.string(), alt: z.string().nullish() })
const listNode = z.looseObject({ ordered: z.boolean().nullish(), children: z.array(z.unknown()) })
const itemNode = z.looseObject({ checked: z.boolean().nullish(), children: z.array(z.unknown()) })
const componentNode = z.looseObject({
	name: z.string(),
	attributes: z.record(z.string(), z.string()).nullish(),
	children: z.array(z.unknown()).nullish(),
})

/** A fault in a lesson file: what is wrong, in words a person fixing the file can act on. */
export class LessonFault extends Error {}

function inline(node: unknown): Inline[] {
	const { type } = anyNode.parse(node)
	switch (type) {
		case 'text':
			return [{ kind: 'text', value: valued.parse(node).value }]
		case 'inlineCode':
			return [{ kind: 'code', value: valued.parse(node).value }]
		case 'break':
			return [{ kind: 'break' }]
		case 'strong':
			return [{ kind: 'strong', children: parent.parse(node).children.flatMap(inline) }]
		case 'emphasis':
			return [{ kind: 'emphasis', children: parent.parse(node).children.flatMap(inline) }]
		case 'link': {
			const read = linkNode.parse(node)
			return [
				{
					kind: 'link',
					href: read.url,
					...(read.title ? { title: read.title } : {}),
					children: read.children.flatMap(inline),
				},
			]
		}
		case 'image': {
			const read = imageNode.parse(node)
			return [{ kind: 'image', src: read.url, alt: read.alt ?? '' }]
		}
		default:
			throw new LessonFault(`a line of prose holds something a lesson may not: ${type}`)
	}
}

function item(node: unknown): ListItem {
	const read = itemNode.parse(node)
	return { checked: read.checked ?? null, children: read.children.flatMap(block) }
}

function block(node: unknown): Block[] {
	const { type } = anyNode.parse(node)
	switch (type) {
		case 'paragraph':
			return [{ kind: 'paragraph', children: parent.parse(node).children.flatMap(inline) }]
		case 'heading': {
			const read = headingNode.parse(node)
			return [{ kind: 'heading', depth: read.depth, children: read.children.flatMap(inline) }]
		}
		case 'thematicBreak':
			return [{ kind: 'rule' }]
		case 'list': {
			const read = listNode.parse(node)
			return [{ kind: 'list', ordered: read.ordered ?? false, items: read.children.map(item) }]
		}
		case 'blockquote':
			return [{ kind: 'quote', children: parent.parse(node).children.flatMap(block) }]
		case 'containerComponent':
		case 'leafComponent': {
			const read = componentNode.parse(node)
			return [
				{
					kind: 'component',
					name: read.name,
					attributes: read.attributes ?? {},
					children: (read.children ?? []).flatMap(block),
				},
			]
		}
		default:
			throw new LessonFault(`a lesson holds something it may not: ${type}`)
	}
}

const wordsOf = (nodes: readonly Inline[]): string =>
	nodes
		.map((node) => {
			switch (node.kind) {
				case 'text':
				case 'code':
					return node.value
				case 'break':
					return ' '
				case 'image':
					return node.alt
				case 'strong':
				case 'emphasis':
				case 'link':
					return wordsOf(node.children)
			}
		})
		.join('')

/** Read a lesson file's text. Throws a `LessonFault` naming every fault found. */
export function parseLesson(markdown: string): Lesson {
	const body = parent.parse(reader.parse(markdown)).children.flatMap(block)
	const [first, ...rest] = body
	if (first?.kind !== 'heading' || first.depth !== 1) {
		throw new LessonFault('a lesson begins with its title: a first-level heading')
	}
	const title = wordsOf(first.children).trim()
	if (!title) throw new LessonFault('the lesson’s title is empty')
	const faults = rest.flatMap((each) => (each.kind === 'component' ? faultsOf(each) : []))
	if (faults.length > 0) throw new LessonFault(faults.join('\n'))
	return { title, body: rest }
}
