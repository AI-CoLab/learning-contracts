/**
 * What a lesson is, as data. One definition for everything that writes or reads lesson files:
 * the scripts that convert a source's material, the build step that loads it, the applet that
 * serves it and the views that draw it.
 *
 *   ./lesson      a lesson read: its title and its blocks
 *   ./components  the components a lesson file may name, and what each may hold
 *   ./parse       the one reader of a lesson file
 *   ./content     a source's content as it lies in its repository, and its reader (Node only)
 */

export { type AttributesOf, COMPONENTS, type ComponentName, faultsOf, isComponentName } from './components.ts'
export {
	type Block,
	blockSchema,
	type ComponentBlock,
	type Inline,
	inlineSchema,
	type Lesson,
	type ListItem,
	lessonSchema,
} from './lesson.ts'
export { LessonFault, parseLesson } from './parse.ts'
