// Turns one lesson of an Articulate Rise course into one Markdown file.
//
// The file is plain Markdown, one paragraph per line, with COMPONENTS named where something
// other than prose goes. A component is written in the block syntax Nuxt Content also reads
// (MDC): `::name{key="value"}` opens it, `::` closes it, and one nested inside another has
// one more colon. The rules the files follow:
//
//   - WORDS are never in attributes. Attributes hold only what a machine reads: a file's
//     path, a link's address, a kind, a position. Every word a person reads is Markdown in
//     the component's body, so it is edited, merged and translated like any other prose.
//   - A component's NAME for itself (an accordion item's title, a button's label, a step's
//     title) is the first heading in its body, as a lesson's title is its first heading.
//   - A question's choices are a task list: `- [x]` marks a right answer.
//
// Nothing is reworded. A block of a kind this file does not know stops the conversion, and
// each converted lesson is checked word for word against the text it came from
// (`checkWords`): any difference stops it too.
//
// The components a file may name, and what each may hold, are ../src/components.ts's table:
// what this script writes is held to it by ../scripts/check-content.ts.
//
// This file also holds what every converter of a source needs, whatever the source: rich text
// to Markdown (`markdownOf`, `lineOf`), a component's text (`component`), a heading, and the
// word check's two halves (`textOfHtml`, `wordsOfMarkdown`). A source with material of its own
// kind (Moodle's pages and quizzes, say) writes its converter in its own repository over these.

import rehypeParse from 'rehype-parse'
import rehypeRemark from 'rehype-remark'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

/**
 * Markdown cannot end emphasis on a space ("_note: _Text"), so the writer would spell the next
 * letter as a character code to keep it valid. Move the space outside the emphasis instead:
 * the same words, readable in the file.
 */
function spacesOutOfEmphasis() {
  const fix = (parent) => {
    const out = []
    for (const node of parent.children ?? []) {
      if (node.children) fix(node)
      if (node.type !== 'emphasis' && node.type !== 'strong') {
        out.push(node)
        continue
      }
      const first = node.children[0]
      const last = node.children.at(-1)
      const leading = first?.type === 'text' ? (first.value.match(/^\s+/)?.[0] ?? '') : ''
      if (leading) first.value = first.value.slice(leading.length)
      const trailing = last?.type === 'text' ? (last.value.match(/\s+$/)?.[0] ?? '') : ''
      if (trailing) last.value = last.value.slice(0, -trailing.length)
      node.children = node.children.filter((child) => child.type !== 'text' || child.value !== '')
      if (leading) out.push({ type: 'text', value: ' ' })
      // Emphasis over punctuation alone ("course<em>.</em>") says nothing: keep the characters.
      const worded = /[\p{L}\p{N}]/u.test(JSON.stringify(node.children.map((child) => child.value ?? child.children)))
      if (worded) out.push(node)
      else out.push(...node.children)
      if (trailing) out.push({ type: 'text', value: ' ' })
    }
    parent.children = out
  }
  return (tree) => fix(tree)
}

/**
 * Editors leave paragraphs wrapped in elements that only carry styling (`<span><p>…</p><p>…</p>
 * </span>`). Read as written, the wrapper makes the paragraphs one run of text and their last
 * and first words join. A span or font element says nothing Markdown keeps, so its children
 * take its place, and the paragraphs are paragraphs again.
 */
function unwrapStyling() {
  const STYLING = new Set(['span', 'font'])
  const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 'a'])
  const BLOCK = new Set(['p', 'div', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table'])
  const isBlock = (node) => node.type === 'element' && BLOCK.has(node.tagName)
  // Text pasted from Google Docs arrives inside one element it marks with its own id
  // (`<b id="docs-internal-guid-…">`, a `<b>` the paste styles as NOT bold): a wrapper, never
  // emphasis, whatever its tag.
  const isPasteWrapper = (node) => String(node.properties?.id ?? '').startsWith('docs-internal-guid-')
  const fix = (parent) => {
    parent.children = (parent.children ?? []).flatMap((node) => {
      if (node.children) fix(node)
      if (node.type !== 'element') return [node]
      if (STYLING.has(node.tagName) || isPasteWrapper(node)) return node.children
      // Bold or a link wrapped round whole paragraphs (`<b><p>…</p><p>…</p></b>`) is the same
      // fault: put it inside each paragraph instead, so each stays a paragraph.
      if (INLINE.has(node.tagName) && node.children.some(isBlock)) {
        const inside = (children) => [{ ...node, children }]
        return node.children.flatMap((child) => {
          if (isBlock(child)) return [{ ...child, children: inside(child.children) }]
          if (child.type === 'text' && child.value.trim() === '') return [child]
          return inside([child])
        })
      }
      return [node]
    })
  }
  return (tree) => fix(tree)
}

/**
 * What an editor left behind that shows a reader nothing: a line break at the start or end of
 * a paragraph (or standing alone between two, as `<p><br></p>` and a bare `<br>` do), a link or
 * emphasis round no words and no picture, a heading or paragraph left with nothing in it.
 * Written to Markdown these come out as marks a reader meets as text (`**\ **`, a lone `\`).
 * None of them is a word, so nothing a reader is told is lost.
 */
function dropEmpty() {
  // What holds a line of prose; a list's item among them (`<li><br></li>` is an item of nothing).
  const PHRASING = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'link', 'listItem'])
  const shows = (node) =>
    node.type === 'image' ||
    node.type === 'inlineCode' ||
    (node.type === 'text' && node.value.trim() !== '') ||
    (node.children ?? []).some(shows)
  const fix = (parent) => {
    parent.children = (parent.children ?? []).flatMap((node) => {
      if (node.children) fix(node)
      if (!PHRASING.has(node.type)) return [node]
      // A break at either end, and any spaces between it and the end.
      const space = (child) => child?.type === 'text' && child.value.trim() === ''
      const breakAt = (end) => {
        const [outer, inner] = end === 'start' ? node.children : node.children.slice(-2).reverse()
        return outer?.type === 'break' ? 1 : space(outer) && inner?.type === 'break' ? 2 : 0
      }
      for (let n = breakAt('start'); n > 0; n = breakAt('start')) node.children.splice(0, n)
      for (let n = breakAt('end'); n > 0; n = breakAt('end')) node.children.splice(-n, n)
      return shows(node) ? [node] : []
    })
  }
  return (tree) => fix(tree)
}

const toMarkdown = unified()
  .use(rehypeParse, { fragment: true })
  .use(unwrapStyling)
  .use(rehypeRemark)
  .use(spacesOutOfEmphasis)
  .use(dropEmpty)
  // Asterisks for emphasis: unlike underscores they may sit inside a word ("un*believ*able").
  .use(remarkStringify, { bullet: '-', emphasis: '*', listItemIndent: 'one', rule: '-' })

/** Rich text as Markdown: one paragraph per line, no trailing space. */
export function markdownOf(html) {
  if (!html) return ''
  // An author's comment in the markup is not something a reader meets.
  const text = String(toMarkdown.processSync(String(html).replace(/<!--[\s\S]*?-->/g, '')))
  return text
    // Spaces and line breaks the writer spelled as character codes (inside a link or heading).
    .replace(/ |&#x20;|&#xA0;|&#xA;|&#xD;/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Rich text as one line of Markdown: for a heading. */
export const lineOf = (html) =>
  markdownOf(html)
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/^(\*\*|__)(.*)\1$/, '$2') // a heading that was only bold is just a heading
    .trim()

const attributes = (values) => {
  const pairs = Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (pairs.length === 0) return ''
  return `{${pairs.map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`).join(' ')}}`
}

/** A component: its name, its machine-read attributes, and its body as Markdown blocks. */
export function component(depth, name, values, blocks) {
  const fence = ':'.repeat(depth + 2)
  const body = blocks.filter(Boolean).join('\n\n')
  return body ? `${fence}${name}${attributes(values)}\n${body}\n${fence}` : `${fence}${name}${attributes(values)}\n${fence}`
}

export const heading = (level, text) => (text ? `${'#'.repeat(level)} ${text}` : '')

/** A media file's path under the repo's files/ folder, from the name Rise keeps it by. */
const fileOf = (media, base) => {
  if (!media) return undefined
  const key = media.useCrushedKey && media.crushedKey ? media.crushedKey : media.key
  if (!key) return undefined
  // A key is the file's path inside the package's assets (two videos of one name sit in two
  // folders), unless it is the address Rise's own storage knew it by, whose last part it is.
  const path = decodeURIComponent(key)
  return `${base}/${path.startsWith('rise/') ? path.split('/').pop() : path}`
}

const picture = (image, base) => {
  const src = fileOf(image, base)
  return src ? `![${image.alt ?? ''}](<${src}>)` : ''
}

// --- questions -----------------------------------------------------------------------------

const QUESTION_KIND = {
  MULTIPLE_CHOICE: 'one',
  MULTIPLE_RESPONSE: 'several',
  FILL_IN_THE_BLANK: 'fill-in',
  MATCHING: 'matching',
}

function question(depth, item) {
  const kind = QUESTION_KIND[item.type]
  if (!kind) throw new Error(`a question of a kind this script does not know: ${item.type}`)
  const answers = (item.answers ?? []).map((answer) => {
    const said = lineOf(answer.title)
    if (kind === 'matching') return `- ${said}\n  - ${lineOf(answer.matchTitle)}`
    const own = markdownOf(answer.feedback)
    const line = `- [${answer.correct ? 'x' : ' '}] ${said}`
    return own ? `${line}\n\n  ${own.replace(/\n/g, '\n  ')}` : line
  })
  const feedback = [
    ['always', item.feedback],
    ['correct', item.feedbackCorrect],
    ['incorrect', item.feedbackIncorrect],
  ]
    .map(([when, html]) => [when, markdownOf(html)])
    .filter(([, text]) => text)
    .map(([when, text]) => component(depth + 1, 'feedback', { when }, [text]))
  return component(depth, 'knowledge-check', { kind }, [markdownOf(item.title), answers.join('\n'), ...feedback])
}

// --- blocks --------------------------------------------------------------------------------

/** The items of a block, each as a child component whose name for itself is a heading. */
const children = (depth, name, items, valuesOf = () => ({})) =>
  items.map((item) =>
    component(depth + 1, name, valuesOf(item), [heading(3, lineOf(item.title)), markdownOf(item.description)]),
  )

function scenario(depth, item) {
  const idOf = new Map(item.slides.map((slide, index) => [slide.id, `s${index + 1}`]))
  const to = (step) => (step.goTo === 'slide' ? idOf.get(step.nextSlide) : step.goTo) || undefined
  const scenes = item.slides.map((slide) => {
    const responses = (slide.responses ?? []).map((response) =>
      component(depth + 2, 'response', { to: to(response), action: response.action, emotion: response.emotion }, [
        markdownOf(response.description),
        markdownOf(response.feedback) && component(depth + 3, 'feedback', { when: 'always' }, [markdownOf(response.feedback)]),
      ]),
    )
    return component(depth + 1, 'scene', { id: idOf.get(slide.id), kind: slide.type, to: to(slide), emotion: slide.emotion }, [
      heading(4, lineOf(slide.title)),
      markdownOf(slide.description),
      ...responses,
    ])
  })
  return component(depth, 'scenario', { character: item.character?.name }, [heading(3, lineOf(item.title)), ...scenes])
}

/**
 * Whether a text block shows its heading, and its paragraph. Rise keeps both fields on every
 * text block, whatever it shows: a "heading" or "subheading" block shows the heading alone, a
 * "paragraph" block the paragraph alone, and what the other field holds is left over from an
 * earlier edit. Only what is shown is kept.
 */
const shows = (block, field) => {
  if (block.family !== 'text' && block.type !== 'text') return true
  const variant = block.variant
  if (field === 'heading') return variant.includes('heading')
  return variant !== 'heading' && variant !== 'subheading'
}

/** One block as Markdown, by its family and variant. Each entry says what Rise's block is. */
const BLOCKS = {
  text: (block) =>
    block.items.map((item) => {
      const level = block.variant.startsWith('subheading') ? 3 : 2
      return [shows(block, 'heading') && heading(level, lineOf(item.heading)), shows(block, 'paragraph') && markdownOf(item.paragraph)]
        .filter(Boolean)
        .join('\n\n')
    }),
  list: (block) => {
    const mark = (index) => (block.variant === 'numbered' ? `${index + 1}.` : '-')
    return [block.items.map((item, index) => `${mark(index)} ${lineOf(item.paragraph)}`).join('\n')]
  },
  impact: (block) =>
    block.items.map((item) =>
      component(0, 'callout', { style: block.variant }, [
        // Rise leaves the word "Heading" in a callout whose heading was never written.
        lineOf(item.heading) !== 'Heading' && heading(3, lineOf(item.heading)),
        markdownOf(item.paragraph),
      ]),
    ),
  multimedia: (block, base) => {
    if (block.variant !== 'video') throw new Error(`media of a kind this script does not know: ${block.variant}`)
    return block.items.map((item) => {
      const video = item.media.video
      const captions = (video.captions ?? []).map((track) => fileOf({ key: track.key }, base))[0]
      return component(
        0,
        'video',
        { src: fileOf(video, base), captions, poster: video.poster && fileOf({ key: video.poster }, base), seconds: video.duration },
        [markdownOf(item.caption)],
      )
    })
  },
  image: (block, base) =>
    block.items.map((item) =>
      component(0, 'figure', { layout: block.variant }, [picture(item.media?.image, base), markdownOf(item.caption), markdownOf(item.paragraph)]),
    ),
  gallery: (block, base) => [
    component(
      0,
      'gallery',
      { layout: block.variant },
      block.items.map((item) => [picture(item.media?.image, base), markdownOf(item.caption)].filter(Boolean).join('\n\n')),
    ),
  ],
  interactive: (block) => {
    const names = { accordion: ['accordion', 'accordion-item'], tabs: ['tabs', 'tab'] }[block.variant]
    if (names) return [component(0, names[0], {}, children(0, names[1], block.items))]
    if (block.variant === 'button') return BLOCKS.buttons(block)
    throw new Error(`an interactive block of a kind this script does not know: ${block.variant}`)
  },
  'interactive-fullscreen': (block, base) => {
    if (block.variant === 'process') {
      return [component(0, 'process', {}, children(0, 'step', block.items.filter((item) => !item.isHidden), (item) => ({ kind: item.type })))]
    }
    if (block.variant === 'labeledgraphic') {
      const markers = children(0, 'marker', block.items, (item) => ({ x: Number(item.x).toFixed(1), y: Number(item.y).toFixed(1) }))
      return [component(0, 'labelled-picture', {}, [picture(block.media?.image, base), ...markers])]
    }
    if (block.variant === 'scenario') return block.items.map((item) => scenario(0, item))
    throw new Error(`a full-screen block of a kind this script does not know: ${block.variant}`)
  },
  buttons: (block) =>
    block.items.map((item) =>
      // A button is a link out, or Rise's "leave the course". The source has one that leads
      // nowhere (its address was never filled in); it is written as it is.
      component(0, 'button', { to: item.destination, kind: item.type === 'link' ? undefined : item.type }, [
        heading(3, lineOf(item.label)),
        markdownOf(item.description),
      ]),
    ),
  knowledgeCheck: (block) => block.items.map((item) => question(0, item)),
  continue: (block) =>
    block.items.map((item) => component(0, 'continue', {}, [heading(3, lineOf(item.title)), markdownOf(item.completeHint)])),
  // Rise's spacing between blocks: nothing to read, nothing kept.
  divider: () => [],
}

/** One Rise lesson as a Markdown file's text. `base` is where its media sits under files/. */
export function lessonMarkdown(lesson, base) {
  const parts = [heading(1, lineOf(lesson.title))]
  if (lesson.type === 'quiz') {
    parts.push(markdownOf(lesson.description))
    for (const item of lesson.items ?? []) parts.push(question(0, item))
  } else if (lesson.type === 'blocks') {
    for (const block of lesson.items ?? []) {
      const family = block.family ?? block.type
      const write = BLOCKS[family]
      if (!write) throw new Error(`a block of a kind this script does not know: ${family}/${block.variant}`)
      parts.push(...write(block, base))
    }
  } else {
    throw new Error(`a lesson of a kind this script does not know: ${lesson.type}`)
  }
  return `${parts.filter(Boolean).join('\n\n')}\n`
}

// --- the word check ------------------------------------------------------------------------

export const wordsIn = (text) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])

/** The words a reader meets in a lesson's Markdown: what is left when the syntax is taken off. */
export function wordsOfMarkdown(markdown) {
  const read = markdown
    .split('\n')
    .filter((line) => !/^\s*:{2,}/.test(line)) // a component's opening and closing lines
    .join('\n')
    .replace(/^(\s*)- \[[ x]\] /gm, '$1- ') // a choice's mark
    .replace(/^(\s*(?:[-#]+ +)*)\d+\. /gm, '$1') // a numbered item's number, which Markdown writes and the source does not
    .replace(/!\[([^\]]*)\]\(<[^>]*>\)/g, '$1') // a picture: its words are its description
    .replace(/\]\((?:<[^>]*>|[^\s)]*)(?:\s+"(?:[^"\\]|\\.)*")?\)/g, ']') // a link: its words are its text, not its address or hover title
    .replace(/&quot;/g, '"')
  return wordsIn(read)
}

const htmlWords = unified().use(rehypeParse, { fragment: true })
export const textOfHtml = (html) => {
  const out = []
  const walk = (node) => {
    if (node.type === 'text') out.push(node.value)
    if (node.tagName === 'img' && node.properties?.alt) out.push(String(node.properties.alt))
    for (const child of node.children ?? []) walk(child)
    out.push(' ')
  }
  walk(htmlWords.parse(html ?? ''))
  return out.join('')
}

/** The words of the source text a lesson's Markdown is written from, in the order written. */
export function wordsOfLesson(lesson) {
  const said = []
  const say = (html) => said.push(textOfHtml(html))
  const sayQuestion = (item) => {
    say(item.title)
    for (const answer of item.answers ?? []) {
      say(answer.title)
      say(answer.matchTitle)
      say(answer.feedback)
    }
    say(item.feedback)
    say(item.feedbackCorrect)
    say(item.feedbackIncorrect)
  }
  say(lesson.title)
  if (lesson.type === 'quiz') {
    say(lesson.description)
    for (const item of lesson.items ?? []) sayQuestion(item)
    return wordsIn(said.join(' '))
  }
  for (const block of lesson.items ?? []) {
    const family = block.family ?? block.type
    if (family === 'divider') continue
    if (block.media?.image?.alt) say(block.media.image.alt)
    for (const item of block.items ?? []) {
      if (family === 'knowledgeCheck') {
        sayQuestion(item)
        continue
      }
      if (family === 'interactive-fullscreen' && block.variant === 'process' && item.isHidden) continue
      const headed = family === 'text' ? shows({ ...block, family }, 'heading') : true
      if (headed && !(family === 'impact' && textOfHtml(item.heading).trim() === 'Heading')) say(item.heading)
      if (item.media?.image?.alt) say(item.media.image.alt)
      say(item.title)
      say(item.label)
      say(item.caption)
      if (family !== 'text' || shows({ ...block, family }, 'paragraph')) say(item.paragraph)
      say(item.description)
      say(item.completeHint)
      for (const slide of item.slides ?? []) {
        say(slide.title)
        say(slide.description)
        for (const response of slide.responses ?? []) {
          say(response.description)
          say(response.feedback)
        }
      }
    }
  }
  return wordsIn(said.join(' '))
}

/** Stops with the first word that differs between a lesson's source and its Markdown. */
export function checkWords(lesson, markdown) {
  const from = wordsOfLesson(lesson)
  const to = wordsOfMarkdown(markdown)
  const length = Math.max(from.length, to.length)
  for (let i = 0; i < length; i++) {
    if (from[i] !== to[i]) {
      const around = (words) => words.slice(Math.max(0, i - 4), i + 5).join(' ')
      throw new Error(
        `words differ at word ${i + 1} of "${lesson.title}":\n  source:   … ${around(from)} …\n  markdown: … ${around(to)} …`,
      )
    }
  }
  return from.length
}

const numbered = (index, title) => `${String(index + 1).padStart(2, '0')}.${slugOf(title) || 'untitled'}`

/**
 * Every lesson of a Rise course as a file: its path below the course's folder, its Markdown,
 * and how many words were checked. Files are numbered in the course's own order, with a dot
 * after the number (the ordering Nuxt Content reads). A Rise "section" is a heading over the
 * lessons that follow it, so it becomes their folder.
 */
export function lessonFiles(course, base) {
  const files = []
  let folder = ''
  let inFolder = 0
  let atTop = 0
  for (const lesson of course.lessons ?? []) {
    if (lesson.type === 'section') {
      folder = `${numbered(atTop++, lesson.title)}/`
      inFolder = 0
      // The folder's own page carries its title, since its name is only a slug.
      const index = `${heading(1, lineOf(lesson.title))}\n`
      files.push({ path: `${folder}index.md`, markdown: index, words: wordsOfMarkdown(index).length })
      continue
    }
    const markdown = lessonMarkdown(lesson, base)
    const words = checkWords(lesson, markdown)
    const name = folder ? numbered(inFolder++, lesson.title) : numbered(atTop++, lesson.title)
    files.push({ path: `${folder}${name}.md`, markdown, words })
  }
  return files
}

export const slugOf = (text) =>
  String(text)
    .normalize('NFKD')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
