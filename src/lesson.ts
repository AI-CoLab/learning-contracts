/**
 * A LESSON as data: what a lesson file is once it has been read (./parse.ts).
 *
 * A lesson file is Markdown. Read, it is a title and a body of BLOCKS: the prose Markdown
 * has (paragraphs, headings, lists, quotes) and COMPONENTS, each named where it goes with
 * its own body of blocks inside it. Words are always in blocks; a component's attributes
 * hold only what a machine reads (./components.ts says which, per component).
 *
 * This tree is what crosses every boundary: a build step stores it, an operation answers
 * it, a view draws it, and an agent is handed it back as Markdown. It carries no code.
 */

import { z } from 'zod'

// ---- inline: what runs inside a line of prose ----------------------------------------------

const text = z.object({ kind: z.literal('text'), value: z.string() })
const code = z.object({ kind: z.literal('code'), value: z.string() })
const lineBreak = z.object({ kind: z.literal('break') })
const image = z.object({
	kind: z.literal('image'),
	/** A file's path under the source's media, or an address. */
	src: z.string().min(1),
	/** What the picture shows, for a reader who cannot see it; empty where the source said nothing. */
	alt: z.string(),
})
const strong = z.object({
	kind: z.literal('strong'),
	get children() {
		return z.array(inlineSchema)
	},
})
const emphasis = z.object({
	kind: z.literal('emphasis'),
	get children() {
		return z.array(inlineSchema)
	},
})
const link = z.object({
	kind: z.literal('link'),
	href: z.string(),
	/** The text a pointer shows over the link, where the source gave one. */
	title: z.string().optional(),
	get children() {
		return z.array(inlineSchema)
	},
})

export const inlineSchema = z.discriminatedUnion('kind', [
	text,
	code,
	lineBreak,
	image,
	strong,
	emphasis,
	link,
])
export type Inline = z.infer<typeof inlineSchema>

// ---- blocks ----------------------------------------------------------------------------------

const paragraph = z.object({ kind: z.literal('paragraph'), children: z.array(inlineSchema) })
const heading = z.object({
	kind: z.literal('heading'),
	depth: z.number().int().min(1).max(6),
	children: z.array(inlineSchema),
})
const rule = z.object({ kind: z.literal('rule') })
const listItem = z.object({
	/** A task list's mark: true ticked, false unticked, null for an item of an ordinary list. */
	checked: z.boolean().nullable(),
	get children() {
		return z.array(blockSchema)
	},
})
const list = z.object({
	kind: z.literal('list'),
	ordered: z.boolean(),
	items: z.array(listItem),
})
const quote = z.object({
	kind: z.literal('quote'),
	get children() {
		return z.array(blockSchema)
	},
})
const component = z.object({
	kind: z.literal('component'),
	/** Which component: a name of ./components.ts's table. */
	name: z.string().min(1),
	/** What a machine reads of it, as written in the file: every value a string. */
	attributes: z.record(z.string(), z.string()),
	get children() {
		return z.array(blockSchema)
	},
})

export const blockSchema = z.discriminatedUnion('kind', [
	paragraph,
	heading,
	rule,
	list,
	quote,
	component,
])
export type Block = z.infer<typeof blockSchema>
export type ComponentBlock = z.infer<typeof component>
export type ListItem = z.infer<typeof listItem>

// ---- a lesson --------------------------------------------------------------------------------

export const lessonSchema = z.object({
	/** Its title: the words of the file's first heading. */
	title: z.string().min(1),
	/** Everything after the title. */
	body: z.array(blockSchema),
})
export type Lesson = z.infer<typeof lessonSchema>
