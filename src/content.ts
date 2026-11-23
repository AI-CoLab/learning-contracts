/**
 * A source's CONTENT as it lies in its repository, and the one reader of that layout.
 *
 *   content/source.json                   who publishes it, and on what terms
 *   content/courses/<course>/index.md     a course: its title and summary
 *     <NN.name>/index.md                  a folder under it (a section, a package of lessons)
 *     <NN.name>.md                        a lesson
 *
 * A folder or a lesson is ordered by the number before the first dot of its name, and known
 * by the slug after it (the ordering Nuxt Content reads). A folder's title is the first
 * heading of its index.md, as a lesson's is of its own file; a name is only an address.
 *
 * Node only: it reads the disk. The shapes it answers are plain data.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { blockSchema } from './lesson.ts'
import { LessonFault, parseLesson } from './parse.ts'

/** Who publishes a body of content, and on what terms it may be reused. */
export const sourceSchema = z.strictObject({
	/** The source's slug: how the platform names it. */
	id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
	name: z.string().min(1),
	/** Where the source publishes this content. */
	home: z.url(),
	licence: z.strictObject({
		/** Its SPDX identifier, e.g. CC-BY-SA-4.0. */
		spdx: z.string().min(1),
		url: z.url(),
	}),
	/** The credit the licence asks for, as the source words it. */
	attribution: z.string().min(1),
})
export type Source = z.infer<typeof sourceSchema>

const SLUG = /^[a-z0-9][a-z0-9-]*$/

const lessonNode = z.object({
	kind: z.literal('lesson'),
	slug: z.string().regex(SLUG),
	title: z.string().min(1),
	body: z.array(blockSchema),
})
const folderNode = z.object({
	kind: z.literal('folder'),
	slug: z.string().regex(SLUG),
	title: z.string().min(1),
	/** What its index.md says under the title. */
	body: z.array(blockSchema),
	get children() {
		return z.array(z.discriminatedUnion('kind', [folderNode, lessonNode]))
	},
})
export const courseSchema = folderNode
export type Folder = z.infer<typeof folderNode>
export type LessonNode = z.infer<typeof lessonNode>

export const contentSchema = z.object({ source: sourceSchema, courses: z.array(courseSchema) })
export type Content = z.infer<typeof contentSchema>

/** A file's fault, with the file it is in. */
export class ContentFault extends Error {
	readonly path: string
	constructor(path: string, why: string) {
		super(`${path}: ${why}`)
		this.path = path
	}
}

const ORDERED = /^(\d+)\.(.+)$/

/** A name's order and slug: `03.first-steps` is third and known as `first-steps`. */
function placeOf(name: string): { order: number; slug: string } | null {
	const numbered = ORDERED.exec(name)
	if (!numbered) return null
	const [, order = '', slug = ''] = numbered
	return SLUG.test(slug) ? { order: Number(order), slug } : null
}

async function readLesson(path: string) {
	try {
		return parseLesson(await readFile(path, 'utf8'))
	} catch (error) {
		if (error instanceof LessonFault) throw new ContentFault(path, error.message)
		throw error
	}
}

async function readFolder(dir: string, slug: string): Promise<Folder> {
	const entries = await readdir(dir, { withFileTypes: true })
	if (!entries.some((entry) => entry.isFile() && entry.name === 'index.md')) {
		throw new ContentFault(dir, 'a folder has an index.md with its title')
	}
	const index = await readLesson(join(dir, 'index.md'))
	const placed: { order: number; child: Folder | LessonNode }[] = []
	for (const entry of entries) {
		if (entry.name === 'index.md' || entry.name.startsWith('.')) continue
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			const place = placeOf(entry.name)
			if (!place) throw new ContentFault(path, 'a folder is named <number>.<slug>')
			placed.push({ order: place.order, child: await readFolder(path, place.slug) })
		} else if (entry.name.endsWith('.md')) {
			const place = placeOf(entry.name.slice(0, -'.md'.length))
			if (!place) throw new ContentFault(path, 'a lesson is named <number>.<slug>.md')
			placed.push({
				order: place.order,
				child: { kind: 'lesson', slug: place.slug, ...(await readLesson(path)) },
			})
		} else {
			throw new ContentFault(path, 'only lessons (.md) and folders belong under a course')
		}
	}
	const orders = new Set(placed.map((each) => each.order))
	if (orders.size !== placed.length) throw new ContentFault(dir, 'two entries share a number')
	placed.sort((a, b) => a.order - b.order)
	return {
		kind: 'folder',
		slug,
		title: index.title,
		body: index.body,
		children: placed.map((each) => each.child),
	}
}

/** Read a source's content folder whole: its source record and every course. */
export async function readContent(root: string): Promise<Content> {
	const sourcePath = join(root, 'source.json')
	const read = sourceSchema.safeParse(JSON.parse(await readFile(sourcePath, 'utf8')))
	if (!read.success) throw new ContentFault(sourcePath, z.prettifyError(read.error))
	const coursesDir = join(root, 'courses')
	const names = (await readdir(coursesDir, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
	const courses: Folder[] = []
	for (const name of names) {
		if (!SLUG.test(name)) throw new ContentFault(join(coursesDir, name), 'a course is named by a slug')
		courses.push(await readFolder(join(coursesDir, name), name))
	}
	return { source: read.data, courses }
}
