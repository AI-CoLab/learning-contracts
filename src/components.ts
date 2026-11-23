/**
 * The COMPONENTS a lesson file may name: ONE table, one entry per component, each saying
 *
 *   attributes   what a machine reads of it (a file's path, an address, a kind, a position),
 *                as a strict schema: an attribute the table does not list is refused;
 *   holds        the components that may stand directly inside it, beside prose;
 *   inside       for a component that is a part of another, the components it may stand
 *                directly inside; unsaid, it may stand anywhere a lesson has blocks.
 *
 * What a component DOES is not here and cannot be: that is the code of whoever draws it.
 * This table is only what a file may write, so that a file is checked the day it is written
 * and every reader of lesson files agrees on what they contain.
 *
 * A component's own name for itself (an accordion item's title, a button's label) is the
 * first heading of its body, never an attribute; so are all its words.
 */

import { z } from 'zod'
import type { ComponentBlock } from './lesson.ts'

/** A whole number written as an attribute. */
const seconds = z.coerce.number().int().min(0)
/** A position across or down a picture, as a percentage. */
const percent = z.coerce.number().min(0).max(100)

interface ComponentRule {
	attributes: z.ZodObject
	holds: readonly string[]
	inside?: readonly string[]
}

export const COMPONENTS = {
	/** A video: a file under the source's media, or an address. Its body is its caption, and
	 *  any questions shown while it plays. */
	video: {
		attributes: z.strictObject({
			src: z.string().min(1),
			captions: z.string().min(1).optional(),
			poster: z.string().min(1).optional(),
			seconds: seconds.optional(),
		}),
		holds: ['knowledge-check'],
	},
	/** Items that open one at a time. */
	accordion: { attributes: z.strictObject({}), holds: ['accordion-item'] },
	'accordion-item': { attributes: z.strictObject({}), holds: [], inside: ['accordion'] },
	/** The same kind of content side by side. */
	tabs: { attributes: z.strictObject({}), holds: ['tab'] },
	tab: { attributes: z.strictObject({}), holds: [], inside: ['tabs'] },
	/** A passage set apart. `style` is the source's own name for how. */
	callout: { attributes: z.strictObject({ style: z.string().min(1).optional() }), holds: [] },
	/** A picture with its text. `layout` is the source's own name for how they sit. */
	figure: { attributes: z.strictObject({ layout: z.string().min(1).optional() }), holds: [] },
	/** Several pictures. */
	gallery: { attributes: z.strictObject({ layout: z.string().min(1).optional() }), holds: [] },
	/** A picture with markers on it. */
	'labelled-picture': { attributes: z.strictObject({}), holds: ['marker'] },
	marker: {
		attributes: z.strictObject({ x: percent, y: percent }),
		holds: [],
		inside: ['labelled-picture'],
	},
	/** Steps taken in order. */
	process: { attributes: z.strictObject({}), holds: ['step'] },
	step: {
		attributes: z.strictObject({ kind: z.enum(['intro', 'step', 'summary']).optional() }),
		holds: [],
		inside: ['process'],
	},
	/** A branching conversation. */
	scenario: {
		attributes: z.strictObject({ character: z.string().min(1).optional() }),
		holds: ['scene'],
	},
	scene: {
		attributes: z.strictObject({
			id: z.string().min(1),
			kind: z.string().min(1),
			/** Where it leads: another scene's id, or the source's word for it (`next`, `end`). */
			to: z.string().min(1).optional(),
			emotion: z.string().min(1).optional(),
		}),
		holds: ['response'],
		inside: ['scenario'],
	},
	response: {
		attributes: z.strictObject({
			to: z.string().min(1).optional(),
			action: z.string().min(1).optional(),
			emotion: z.string().min(1).optional(),
		}),
		holds: ['feedback'],
		inside: ['scene'],
	},
	/** A question with its answer. Its choices are a task list in its body, a ticked item a
	 *  right answer; for `matching`, each item holds its match as a nested item. */
	'knowledge-check': {
		attributes: z.strictObject({
			kind: z.enum(['one', 'several', 'fill-in', 'matching', 'true-false']),
			/** Inside a video: the second it appears, or `end`. */
			at: z.union([z.literal('end'), seconds]).optional(),
			/** For `true-false`: which the statement is. */
			answer: z.enum(['true', 'false']).optional(),
		}),
		holds: ['feedback'],
	},
	/** What a learner is told after answering. */
	feedback: {
		attributes: z.strictObject({ when: z.enum(['always', 'correct', 'incorrect']) }),
		holds: [],
		inside: ['knowledge-check', 'response'],
	},
	/** A link out, with a line about it; or, by its `kind`, the way out of the course. `to`
	 *  is unsaid where the source's button leads nowhere. */
	button: {
		attributes: z.strictObject({
			to: z.string().min(1).optional(),
			kind: z.enum(['exit-course']).optional(),
		}),
		holds: [],
	},
	/** A gate the learner passes to see what follows. */
	continue: { attributes: z.strictObject({}), holds: [] },
} satisfies Record<string, ComponentRule>

export type ComponentName = keyof typeof COMPONENTS
export const isComponentName = (name: string): name is ComponentName => Object.hasOwn(COMPONENTS, name)

/** What a component's attributes are once read: its entry's schema, applied. */
export type AttributesOf<Name extends ComponentName> = z.output<(typeof COMPONENTS)[Name]['attributes']>

const ruleOf = (name: ComponentName): ComponentRule => COMPONENTS[name]

/**
 * Hold one component, as a file wrote it, to the table: its name, its attributes, where it
 * stands, and (walking down) what stands inside it. Answers every fault found, each in
 * words a person fixing the file can act on; none means the component is sound.
 */
export function faultsOf(block: ComponentBlock, parent?: string): string[] {
	const name = block.name
	if (!isComponentName(name)) return [`"${name}" is not a component a lesson can name`]
	const rule = ruleOf(name)
	const faults: string[] = []
	const read = rule.attributes.safeParse(block.attributes)
	if (!read.success) {
		for (const issue of read.error.issues) {
			faults.push(`${name}: ${issue.path.join('.') || 'attributes'}: ${issue.message}`)
		}
	}
	if (rule.inside && (parent === undefined || !rule.inside.includes(parent))) {
		faults.push(`${name} may only stand inside ${rule.inside.join(' or ')}`)
	}
	for (const child of block.children) {
		if (child.kind !== 'component') continue
		if (!rule.holds.includes(child.name)) faults.push(`${name} may not hold ${child.name}`)
		faults.push(...faultsOf(child, name))
	}
	return faults
}
